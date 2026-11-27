import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import { useFrame, useThree } from "@react-three/fiber";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Color,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  type PointLight,
  SpotLight,
  Vector3,
} from "three";
import { ObjectEnvironment } from "../object-environment.tsx";
import { candelaPerLumen } from "./candela-per-lumen.ts";
import { createLightFade } from "./create-light-fade.ts";
import { getLightColor } from "./get-light-color.ts";
import { getShadeGlow } from "./get-shade-glow.ts";
import { LightEmitterRegistryContext } from "./light-emitter-registry-context.ts";
import { roomLighting } from "./room-lighting.ts";
import { SceneLitContext } from "./scene-lit-context.ts";
import { ShadeGlowRegistryContext } from "./shade-glow-registry-context.ts";
import { shadeRadiusShare } from "./shade-radius-share.ts";
import { ShadowCastersContext } from "./shadow-casters-context.ts";

const shadowSlots = ["nearest", "next"] as const;
const shadowSlotCount = shadowSlots.length;
const beamPenumbra = 0.5;
const shadeRimShare = 0.05;
const shadeRimRangeM = 0.2;
const shadeTransmission = 0.5;
const shadeGlowPerLumen = 0.006;
const zeroDirection = new Vector3();
const shadowProps = {
  "shadow-autoUpdate": false,
  "shadow-mapSize": [512, 512],
  "shadow-camera-near": 0.05,
  "shadow-camera-far": 20,
  "shadow-bias": -0.004,
  "shadow-normalBias": 0.04,
} as const;
const shadowSettleMs = 100;
const precompileDelayMs = 500;
const compileWaitMs = 5000;

type SceneLightingProps = { items: readonly Item[] };

type LightColorCache = { [temperatureK: number]: Color };

type ItemLights = {
  main?: PointLight | SpotLight | null;
  extra?: PointLight | SpotLight | null;
};

function throughShade(options: {
  light: PointLight | SpotLight;
  source: { light: Pick<Light, "shade" | "beam"> };
  tint: Color;
}) {
  if (options.source.light.shade !== "translucent" || options.source.light.beam)
    return;
  options.light.color.multiply(options.tint);
  options.light.intensity *= shadeTransmission;
}

function placeLight(options: {
  light: PointLight | SpotLight;
  source: {
    positionM: Vector3;
    directionM: Vector3;
    light: Pick<Light, "lumens" | "temperatureK" | "beam">;
  };
  cache: LightColorCache;
}) {
  const { light, source } = options;
  light.position.copy(source.positionM);
  setLightColor({
    cache: options.cache,
    color: light.color,
    temperatureK: source.light.temperatureK,
  });
  light.intensity = source.light.lumens * candelaPerLumen;
  if (light instanceof SpotLight && source.light.beam) {
    light.angle = (source.light.beam.angleDeg / 2) * (Math.PI / 180);
    light.target.position.copy(source.positionM).add(source.directionM);
    light.target.updateMatrixWorld();
  }
}

function setLightColor(options: {
  cache: LightColorCache;
  color: Color;
  temperatureK: number;
}) {
  const cached =
    options.cache[options.temperatureK] ?? getLightColor(options.temperatureK);
  options.cache[options.temperatureK] = cached;
  options.color.copy(cached);
}

function hasTarget(
  controls: unknown,
): controls is { getTarget: (out: Vector3) => Vector3 } {
  return (
    typeof controls === "object" &&
    controls !== null &&
    "getTarget" in controls &&
    typeof controls.getTarget === "function"
  );
}

/** Light the room with the ambient, key and environment, plus one point light per item with a `light`, of which the `shadowSlots.length` lit ones nearest the camera target cast shadows. */
export function SceneLighting(props: SceneLightingProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const emitters = useContext(LightEmitterRegistryContext);
  const shadowCasters = useContext(ShadowCastersContext);
  const shadeGlows = useContext(ShadeGlowRegistryContext);
  if (shadeGlows === undefined)
    throw new Error("SceneLighting needs a ShadeGlowRegistryContext");
  const lightItems = props.items.flatMap((item) =>
    item.light === undefined
      ? []
      : [
          {
            id: item.id,
            light: item.light,
            isMirrored: item.mirrored ?? false,
            sizeM: item.sizeM,
          },
        ],
  );
  const isLit = useContext(SceneLitContext);
  const hasLights = lightItems.length > 0;
  const hasBeamLamps = lightItems.some((entry) => entry.light.beam);
  const hasAllDirectionLamps = lightItems.some((entry) => !entry.light.beam);
  const levels = isLit ? roomLighting.lit : roomLighting.unlit;
  const [lightFades] = useState<{
    [itemId: string]: ReturnType<typeof createLightFade>;
  }>(() => Object.create(null));
  const [fadingShadows] = useState<{ [itemId: string]: Mesh[] }>(() =>
    Object.create(null),
  );
  useEffect(() => {
    return () => {
      for (const meshes of Object.values(fadingShadows))
        for (const mesh of meshes) mesh.castShadow = true;
      shadowCasters.isStale = true;
      invalidate();
    };
  }, [fadingShadows, shadowCasters, invalidate]);
  const itemLightRefs = useRef<{ [itemId: string]: ItemLights }>({});
  const slotRefs = useRef<{
    point: (PointLight | null)[];
    spot: (SpotLight | null)[];
  }>({ point: [], spot: [] });
  const slotItemIds = useRef<{
    point: (string | undefined)[];
    spot: (string | undefined)[];
  }>({ point: [], spot: [] });
  const target = useMemo(() => new Vector3(), []);
  const [lightColors] = useState<LightColorCache>(() => ({}));
  const [emitterPositions] = useState<{
    [itemId: string]: { position: Vector3; direction: Vector3 };
  }>(() => ({}));
  const shadowedItems = useRef(props.items);
  const shadowTiming = useRef({
    isPending: false,
    changedAtMs: Number.NEGATIVE_INFINITY,
  });

  const precompileTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const schedulePrecompile = useCallback(() => {
    clearTimeout(precompileTimeout.current);
    precompileTimeout.current = setTimeout(() => {
      const previous = gl.toneMapping;
      gl.toneMapping =
        previous === NoToneMapping ? NeutralToneMapping : NoToneMapping;
      void gl.compileAsync(scene, camera);
      gl.toneMapping = previous;
      for (const slot of [...slotRefs.current.point, ...slotRefs.current.spot])
        if (slot) slot.shadow.needsUpdate = true;
      invalidate();
    }, precompileDelayMs);
  }, [gl, scene, camera, invalidate]);

  useEffect(() => {
    if (hasLights) schedulePrecompile();
    return () => clearTimeout(precompileTimeout.current);
  }, [hasLights, schedulePrecompile]);

  useLayoutEffect(() => {
    const previous = gl.toneMapping;
    gl.toneMapping = isLit ? NeutralToneMapping : NoToneMapping;
    invalidate();
    return () => {
      gl.toneMapping = previous;
      invalidate();
    };
  }, [gl, invalidate, isLit]);

  useLayoutEffect(() => {
    const previous = { enabled: gl.shadowMap.enabled, type: gl.shadowMap.type };
    gl.shadowMap.enabled = hasLights;
    gl.shadowMap.type = PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      gl.shadowMap.enabled = previous.enabled;
      gl.shadowMap.type = previous.type;
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
  }, [gl, invalidate, hasLights]);

  const beamCount = lightItems.filter((entry) => entry.light.beam).length;
  const rigKey = `${isLit}:${beamCount}:${lightItems.length - beamCount}`;
  const shownRig = useRef<string>(undefined);
  useLayoutEffect(() => {
    const isFirstRig = shownRig.current === undefined;
    if (shownRig.current === rigKey) return;
    shownRig.current = rigKey;
    if (isFirstRig) return;
    let isCurrent = true;
    function resume() {
      if (!isCurrent) return;
      isCurrent = false;
      setFrameloop("demand");
      invalidate();
    }
    setFrameloop("never");
    const fallback = setTimeout(resume, compileWaitMs);
    void gl.compileAsync(scene, camera).finally(resume);
    return () => {
      clearTimeout(fallback);
      resume();
    };
  }, [rigKey, gl, scene, camera, setFrameloop, invalidate]);

  useFrame((state) => {
    const nowMs = performance.now();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const itemId of Object.keys(lightFades))
      if (!lightItems.some((entry) => entry.id === itemId)) {
        for (const mesh of fadingShadows[itemId] ?? []) mesh.castShadow = true;
        if (fadingShadows[itemId]?.length) shadowCasters.isStale = true;
        delete fadingShadows[itemId];
        delete lightFades[itemId];
      }
    const fadingItems = lightItems.map((entry) => {
      const fade = lightFades[entry.id] ?? createLightFade();
      lightFades[entry.id] = fade;
      const frame = fade.advance({ on: entry.light.on, nowMs, reduced });
      if (frame.active) state.invalidate();
      if (!entry.light.on && frame.value > 0) {
        const meshes = fadingShadows[entry.id] ?? [];
        fadingShadows[entry.id] = meshes;
        emitters[entry.id]?.parent?.traverse((object) => {
          if (!(object instanceof Mesh) || !object.castShadow) return;
          object.castShadow = false;
          meshes.push(object);
          shadowCasters.isStale = true;
        });
      } else {
        const meshes = fadingShadows[entry.id] ?? [];
        if (!entry.light.on) {
          for (const mesh of meshes) mesh.castShadow = true;
          if (meshes.length) shadowCasters.isStale = true;
        }
        delete fadingShadows[entry.id];
      }
      return {
        ...entry,
        light: { ...entry.light, lumens: entry.light.lumens * frame.value },
      };
    });
    for (const itemId of Object.keys(shadeGlows)) {
      const glow = shadeGlows[itemId];
      if (
        glow === undefined ||
        glow.uniforms.uShadeGlowStrength.value === 0 ||
        lightItems.some((entry) => entry.id === itemId)
      )
        continue;
      glow.uniforms.uShadeGlowStrength.value = 0;
      state.invalidate();
    }
    const controls = state.controls;
    if (hasTarget(controls)) controls.getTarget(target);
    else target.copy(state.camera.position);
    const lit = fadingItems.flatMap((entry) => {
      const emitter = Object.hasOwn(emitters, entry.id)
        ? emitters[entry.id]
        : undefined;
      if (entry.light.lumens === 0 || emitter === undefined) return [];
      const stored = Object.hasOwn(emitterPositions, entry.id)
        ? emitterPositions[entry.id]
        : undefined;
      const positionM = stored ?? {
        position: new Vector3(),
        direction: new Vector3(),
      };
      emitterPositions[entry.id] = positionM;
      emitter.updateWorldMatrix(true, false);
      emitter.getWorldPosition(positionM.position);
      const beam = entry.light.beam;
      if (beam)
        positionM.direction
          .set(
            entry.isMirrored ? -beam.direction.x : beam.direction.x,
            beam.direction.y,
            beam.direction.z,
          )
          .transformDirection(emitter.matrixWorld);
      return [
        {
          ...entry,
          positionM: positionM.position,
          directionM: positionM.direction,
          distanceM: positionM.position.distanceTo(target),
        },
      ];
    });
    const litById = Object.fromEntries(lit.map((entry) => [entry.id, entry]));
    const shadowed = lit
      .toSorted((a, b) => a.distanceM - b.distanceM)
      .slice(0, shadowSlotCount);
    const shadowedIds = {
      point: shadowed
        .filter((entry) => entry.light.beam === undefined)
        .map((entry) => entry.id),
      spot: shadowed
        .filter((entry) => entry.light.beam !== undefined)
        .map((entry) => entry.id),
    };
    const isShadowed = (id: string) =>
      shadowed.some((entry) => entry.id === id);
    for (const entry of fadingItems) {
      const lights = itemLightRefs.current[entry.id];
      if (!lights) continue;
      const source = Object.hasOwn(litById, entry.id)
        ? litById[entry.id]
        : undefined;
      const isTranslucent = entry.light.shade === "translucent";
      const glow = getShadeGlow({ registry: shadeGlows, itemId: entry.id });
      glow.uniforms.uShadeGlowStrength.value =
        source && isTranslucent ? entry.light.lumens * shadeGlowPerLumen : 0;
      if (source && isTranslucent) {
        glow.uniforms.uShadeGlowCentre.value.copy(source.positionM);
        glow.uniforms.uShadeGlowDirection.value.copy(
          entry.light.beam ? source.directionM : zeroDirection,
        );
        glow.uniforms.uShadeGlowRadius.value =
          shadeRadiusShare * Math.max(entry.sizeM.width, entry.sizeM.depth);
      }
      const extra = lights.extra;
      if (extra) {
        extra.intensity = source
          ? entry.light.lumens *
            candelaPerLumen *
            (isTranslucent ? shadeTransmission : shadeRimShare)
          : 0;
        extra.distance = isTranslucent ? 0 : shadeRimRangeM;
        if (source) {
          extra.position.copy(source.positionM);
          setLightColor({
            cache: lightColors,
            color: extra.color,
            temperatureK: entry.light.temperatureK,
          });
          if (isTranslucent) extra.color.multiply(glow.tint);
        }
      }
      const main = lights.main;
      if (!main) continue;
      if (source === undefined || isShadowed(entry.id)) {
        main.intensity = 0;
        continue;
      }
      placeLight({ light: main, source, cache: lightColors });
      throughShade({ light: main, source, tint: glow.tint });
    }
    const isStale =
      shadowCasters.isStale || shadowedItems.current !== props.items;
    shadowCasters.isStale = false;
    shadowedItems.current = props.items;
    if (isStale && hasLights) schedulePrecompile();
    const isMoved = (["point", "spot"] as const).some((kind) =>
      shadowedIds[kind].some(
        (id, index) =>
          slotItemIds.current[kind][index] !== id ||
          !slotRefs.current[kind][index]?.position.equals(
            litById[id]?.positionM ?? target,
          ),
      ),
    );
    const timing = shadowTiming.current;
    const isChanged = isStale || isMoved;
    const isFirstChange =
      isChanged && nowMs - timing.changedAtMs >= shadowSettleMs;
    if (isChanged) timing.changedAtMs = nowMs;
    const isSettled =
      timing.isPending && nowMs - timing.changedAtMs >= shadowSettleMs;
    const isShadowUpdate = isFirstChange || isSettled;
    timing.isPending = isChanged
      ? !isFirstChange
      : timing.isPending && !isSettled;
    if (timing.isPending) state.invalidate();
    for (const kind of ["point", "spot"] as const)
      slotRefs.current[kind].forEach((slot, index) => {
        if (!slot) return;
        const sourceId = shadowedIds[kind].at(index);
        const source = sourceId === undefined ? undefined : litById[sourceId];
        slotItemIds.current[kind][index] = sourceId;
        if (source === undefined) {
          slot.intensity = 0;
          return;
        }
        placeLight({ light: slot, source, cache: lightColors });
        throughShade({
          light: slot,
          source,
          tint: getShadeGlow({ registry: shadeGlows, itemId: source.id }).tint,
        });
        if (isShadowUpdate) slot.shadow.needsUpdate = true;
      });
  });

  return (
    <>
      <ambientLight intensity={levels.ambient} />
      <ObjectEnvironment intensity={levels.environment} />
      <directionalLight position={[2.5, 6, 4]} intensity={levels.key} />
      {hasAllDirectionLamps &&
        shadowSlots.map((slotName, index) => (
          <pointLight
            key={`point-${slotName}`}
            ref={(light) => {
              slotRefs.current.point[index] = light;
            }}
            intensity={0}
            decay={2}
            castShadow
            {...shadowProps}
          />
        ))}
      {hasBeamLamps &&
        shadowSlots.map((slotName, index) => (
          <spotLight
            key={`spot-${slotName}`}
            ref={(light) => {
              slotRefs.current.spot[index] = light;
            }}
            intensity={0}
            decay={2}
            penumbra={beamPenumbra}
            castShadow
            {...shadowProps}
          />
        ))}
      {lightItems.map((entry) => {
        function register(input: {
          part: keyof ItemLights;
          light: PointLight | SpotLight | null;
        }) {
          const lights = itemLightRefs.current[entry.id] ?? {};
          itemLightRefs.current[entry.id] = {
            ...lights,
            [input.part]: input.light,
          };
        }
        function forget() {
          delete itemLightRefs.current[entry.id];
          delete emitterPositions[entry.id];
        }
        return entry.light.beam ? (
          <group key={`${entry.id}-beam`}>
            <spotLight
              ref={(light) => {
                register({ part: "main", light });
                return forget;
              }}
              intensity={0}
              decay={2}
              penumbra={beamPenumbra}
            />
            <pointLight
              ref={(light) => {
                register({ part: "extra", light });
                return forget;
              }}
              intensity={0}
              decay={2}
            />
          </group>
        ) : (
          <pointLight
            key={`${entry.id}-all`}
            ref={(light) => {
              register({ part: "main", light });
              return forget;
            }}
            intensity={0}
            decay={2}
          />
        );
      })}
    </>
  );
}
