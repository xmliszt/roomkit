import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  Box3,
  DoubleSide,
  type Group,
  type Material,
  Mesh,
  Plane,
  Vector3,
} from "three";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { getItemBox } from "../../items/get-item-box.ts";
import { LOAD_IN_TIMING } from "../load-in/load-in-timing.ts";
import { AssetModel } from "../scene/asset-model.tsx";
import { getBoxEdges } from "../scene/get-box-edges.ts";
import { isFloorCovering } from "../scene/is-floor-covering.ts";
import type { AppearanceData } from "./appearance-data.ts";
import { createGenerationPoints } from "./create-generation-points.ts";
import { createTraceLines } from "./create-trace-lines.ts";
import { getAppearanceFrame } from "./get-appearance-frame.ts";

type AppearingAssetProps = {
  projectId: string;
  item: Item;
  assetId: string;
  sourceSizeM: Size;
  data?: AppearanceData | undefined;
  reduced: boolean;
  sceneLoadIn?: { modelRef: RefObject<Group | null>; startedAtMs: number };
  colors: { bg: string; ink: string; accent: string };
  onComplete: () => void;
};

export function AppearingAsset(props: AppearingAssetProps) {
  const ownModelRef = useRef<Group>(null);
  const modelRef = props.sceneLoadIn?.modelRef ?? ownModelRef;
  const boxRef = useRef<LineSegments2>(null);
  const startedAtRef = useRef<number | undefined>(undefined);
  const completedRef = useRef(false);
  const originals = useRef<{
    [id: string]: {
      material: Material;
      opacity: number;
      transparent: boolean;
      clippingPlanes: Material["clippingPlanes"];
    };
  }>({});
  useLayoutEffect(
    () => () => {
      for (const original of Object.values(originals.current)) {
        Object.assign(original.material, {
          opacity: original.opacity,
          transparent: original.transparent,
          clippingPlanes: original.clippingPlanes,
          needsUpdate: true,
        });
      }
      if (modelRef.current) modelRef.current.visible = true;
    },
    [modelRef],
  );
  const invalidate = useThree((state) => state.invalidate);
  const bounds = useMemo(() => new Box3(), []);
  const plane = useMemo(() => new Plane(new Vector3(0, -1, 0)), []);
  const scale = useMemo(
    () => [
      props.item.sizeM.width / (props.data?.meta.nativeSizeM.width ?? 1),
      props.item.sizeM.height / (props.data?.meta.nativeSizeM.height ?? 1),
      props.item.sizeM.depth / (props.data?.meta.nativeSizeM.depth ?? 1),
    ],
    [props.item.sizeM, props.data?.meta.nativeSizeM],
  );
  const gatherFromSurface = props.sceneLoadIn !== undefined;
  const points = useMemo(
    () =>
      props.data && !props.reduced
        ? createGenerationPoints({
            placementKind: props.item.placement.kind,
            sizeM: props.sourceSizeM,
            accent: props.colors.accent,
            gatherFromSurface,
            surface: {
              positions: props.data.points.positions.map(
                (value, index) => value * (scale[index % 3] ?? 1),
              ),
              colors: props.data.points.colors,
            },
          })
        : undefined,
    [
      props.item.placement.kind,
      scale,
      props.sourceSizeM,
      props.data,
      props.colors.accent,
      gatherFromSurface,
      props.reduced,
    ],
  );
  const trace = useMemo(
    () =>
      props.data && !props.reduced
        ? createTraceLines({
            positions: props.data.lines.map(
              (value, index) => value * (scale[index % 3] ?? 1),
            ),
            color: props.colors.ink,
          })
        : undefined,
    [props.data, scale, props.colors.ink, props.reduced],
  );
  const lines = trace?.line;
  const boxEdges = getBoxEdges({
    box: getItemBox({
      placementKind: props.item.placement.kind,
      sizeM: props.sourceSizeM,
    }),
    marginM: 0,
  });

  useEffect(() => {
    invalidate();
    return () => {
      points?.geometry.dispose();
      points?.material.dispose();
      lines?.geometry.dispose();
      lines?.material.dispose();
    };
  }, [points, lines, invalidate]);

  useFrame((state) => {
    const group = modelRef.current;
    if (!group || completedRef.current) return;
    startedAtRef.current ??= state.clock.elapsedTime;
    const frame = getAppearanceFrame({
      elapsedMs: props.sceneLoadIn
        ? performance.now() - props.sceneLoadIn.startedAtMs
        : (state.clock.elapsedTime - startedAtRef.current) * 1000,
      reduced: props.reduced,
      ...(props.sceneLoadIn ? { timing: LOAD_IN_TIMING } : {}),
    });
    group.updateWorldMatrix(true, true);
    bounds.setFromObject(group);
    plane.constant =
      bounds.min.y + (bounds.max.y - bounds.min.y + 0.02) * frame.reveal;
    group.visible = frame.reveal > 0;
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        originals.current[material.uuid] ??= {
          material,
          opacity: material.opacity,
          transparent: material.transparent,
          clippingPlanes: material.clippingPlanes,
        };
        if (material.clippingPlanes?.at(0) !== plane) {
          material.clippingPlanes = [plane];
          material.needsUpdate = true;
        }
        if (props.reduced && !material.transparent) {
          material.transparent = true;
          material.needsUpdate = true;
        }
        material.opacity =
          (originals.current[material.uuid]?.opacity ?? 1) * frame.modelOpacity;
      }
    });
    if (points) {
      const uniforms = points.material.uniforms;
      if (uniforms.uT) uniforms.uT.value = frame.gather;
      if (uniforms.uProg) uniforms.uProg.value = 1.3;
      if (uniforms.uAlpha) uniforms.uAlpha.value = frame.pointsOpacity * 0.9;
      if (uniforms.uTime) uniforms.uTime.value = state.clock.elapsedTime;
      if (uniforms.uDpr) uniforms.uDpr.value = state.gl.getPixelRatio();
      points.visible = frame.pointsOpacity > 0;
    }
    if (lines && trace) {
      trace.setProgress(frame.trace);
      lines.material.resolution.set(state.size.width, state.size.height);
      lines.material.opacity = frame.linesOpacity * 0.85;
      lines.visible = lines.material.opacity > 0 && frame.trace > 0;
    }
    if (boxRef.current) {
      const share = props.reduced ? 1 : 1 - (1 - frame.gather) ** 3;
      const from = props.sourceSizeM;
      const to = props.item.sizeM;
      if (frame.boxOpacity > 0)
        boxRef.current.scale.set(
          1 + (to.width / from.width - 1) * share,
          1 + (to.height / from.height - 1) * share,
          1 + (to.depth / from.depth - 1) * share,
        );
      boxRef.current.material.opacity = frame.boxOpacity * 0.6;
      boxRef.current.visible = frame.boxOpacity > 0;
    }
    if (frame.done) {
      completedRef.current = true;
      props.onComplete();
    }
    state.invalidate();
  });

  return (
    <>
      {!props.sceneLoadIn && (
        <group ref={modelRef} visible={false}>
          <AssetModel
            projectId={props.projectId}
            assetId={props.assetId}
            sizeM={props.item.sizeM}
            colorAdjust={props.item.colorAdjust}
            floorCovering={isFloorCovering({
              placementKind: props.item.placement.kind,
              sizeM: props.item.sizeM,
            })}
          />
        </group>
      )}
      {points && <primitive object={points} visible={!props.reduced} />}
      {lines && <primitive object={lines} />}
      {!props.sceneLoadIn && (
        <Line
          ref={boxRef}
          points={boxEdges}
          segments
          side={DoubleSide}
          dashed
          dashSize={0.03}
          gapSize={0.02}
          color={props.colors.ink}
          lineWidth={1}
          transparent
          opacity={0.6}
        />
      )}
    </>
  );
}
