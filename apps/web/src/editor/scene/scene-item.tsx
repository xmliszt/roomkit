import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { Line } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  memo,
  type RefObject,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  type Camera,
  DoubleSide,
  Euler,
  type Group,
  Quaternion,
  Vector3,
} from "three";
import { getItemBox } from "../../items/get-item-box.ts";
import { getItemDimensionLines } from "../../items/get-item-dimension-lines.ts";
import { getRingRadius } from "../../items/get-ring-radius.ts";
import type { ItemFrame } from "../../items/item-frame.ts";
import type { DimensionLine } from "../../room/dimension-line.ts";
import { isWallHidden } from "../../room/is-wall-hidden.ts";
import type { WallSegment } from "../../room/wall-segment.ts";
import { GenerationVisual } from "../generation/generation-visual.tsx";
import type { getGenerationDisplays } from "../generation/get-generation-displays.ts";
import type { createLoadIn } from "../load-in/create-load-in.ts";
import { LoadInAsset } from "../load-in/load-in-asset.tsx";
import { useLoadInEntry } from "../load-in/use-load-in-entry.ts";
import { AssetErrorBoundary } from "./asset-error-boundary.tsx";
import { AssetModel } from "./asset-model.tsx";
import { clearAssetCache } from "./clear-asset-cache.ts";
import { getBoxEdges } from "./get-box-edges.ts";
import { isFloorCovering } from "./is-floor-covering.ts";
import { getLightEmitterLocalPosition } from "./lighting/get-light-emitter-local-position.ts";
import { LightEmitterRegistryContext } from "./lighting/light-emitter-registry-context.ts";
import { ShadowCastersContext } from "./lighting/shadow-casters-context.ts";

type Point = [number, number, number];

const followRatePerS = 18;
const settledM = 0.0005;
const settledRad = 0.001;
const lineStrongOpacity = 0.36;
const ringSegmentCount = 96;
const minLabelledLinePx = 40;

type SceneItemProps = {
  loadIn: ReturnType<typeof createLoadIn> | undefined;
  projectId: string;
  item: Item;
  frame: ItemFrame;
  wall: WallSegment | undefined;
  selected: boolean;
  primary: boolean;
  hovered: boolean;
  ringShown: boolean;
  following: boolean;
  assetReady: boolean;
  tagged: boolean;
  generation: ReturnType<typeof getGenerationDisplays>[number] | undefined;
  onGenerationComplete: () => void;
  labelRefs: RefObject<{ [key: string]: HTMLElement | null }>;
  colors: { bg: string; ink: string; accent: string; danger: string };
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onRingPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onHoverChange: (hovered: boolean) => void;
};

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const SceneItem = memo(function SceneItem(props: SceneItemProps) {
  const groupRef = useRef<Group>(null);
  const isSettlingRef = useRef(false);
  const isHiddenRef = useRef(false);
  const invalidate = useThree((state) => state.invalidate);
  const emitters = useContext(LightEmitterRegistryContext);
  const shadowCasters = useContext(ShadowCastersContext);
  const projected = useMemo(() => new Vector3(), []);
  const target = {
    position: new Vector3(
      props.frame.positionM.x,
      props.frame.positionM.y,
      props.frame.positionM.z,
    ),
    quaternion: new Quaternion().setFromEuler(
      new Euler(0, props.frame.yawRad, props.frame.rollRad, "YXZ"),
    ),
  };
  const loadInEntry = useLoadInEntry({
    loadIn: props.loadIn,
    itemId: props.item.id,
  });
  useLayoutEffect(
    () => props.loadIn?.mount(props.item.id),
    [props.loadIn, props.item.id],
  );
  useLayoutEffect(() => {
    if (props.selected) props.loadIn?.complete(props.item.id);
  }, [props.selected, props.loadIn, props.item.id]);
  const loadingIn =
    props.item.model.kind === "asset" &&
    loadInEntry?.assetId === props.item.model.assetId &&
    loadInEntry.kind !== "done";
  const waitingForLoadIn = loadingIn && loadInEntry?.kind !== "appearing";
  const placementKind = props.item.placement.kind;
  const floorCovering = isFloorCovering({
    placementKind,
    sizeM: props.item.sizeM,
  });
  const box = getItemBox({ placementKind, sizeM: props.item.sizeM });
  const bottomYM = props.frame.positionM.y + box.y.min;
  const topYM = props.frame.positionM.y + box.y.max;
  const boxCentre: Point = [
    (box.x.min + box.x.max) / 2,
    (box.y.min + box.y.max) / 2,
    (box.z.min + box.z.max) / 2,
  ];
  const boxSize: Point = [
    props.item.sizeM.width,
    props.item.sizeM.height,
    props.item.sizeM.depth,
  ];
  const outline = useMemo(
    () =>
      getBoxEdges({
        box: getItemBox({ placementKind, sizeM: props.item.sizeM }),
        marginM: 0.004,
      }),
    [placementKind, props.item.sizeM],
  );
  const pendingSizeM = props.generation?.sizeM ?? props.item.sizeM;
  const edges = useMemo(
    () =>
      getBoxEdges({
        box: getItemBox({ placementKind, sizeM: pendingSizeM }),
        marginM: 0,
      }),
    [placementKind, pendingSizeM],
  );
  const dimensions = useMemo(
    () => getItemDimensionLines({ placementKind, sizeM: props.item.sizeM }),
    [placementKind, props.item.sizeM],
  );
  const ringRadiusM = getRingRadius({ placementKind, sizeM: props.item.sizeM });
  const ring = useMemo(
    () =>
      Array.from({ length: ringSegmentCount + 1 }, (_, index): Point => {
        const angle = (index / ringSegmentCount) * Math.PI * 2;
        const x = Math.cos(angle) * ringRadiusM;
        const y = Math.sin(angle) * ringRadiusM;
        return placementKind === "wall" ? [x, y, 0.002] : [x, 0.002, -y];
      }),
    [placementKind, ringRadiusM],
  );
  const handle: Point[] =
    placementKind === "wall"
      ? [
          [ringRadiusM - 0.03, 0, 0.002],
          [ringRadiusM + 0.03, 0, 0.002],
        ]
      : [
          [ringRadiusM - 0.03, 0.002, 0],
          [ringRadiusM + 0.03, 0.002, 0],
        ];

  useEffect(() => {
    invalidate();
  });

  useFrame((state, deltaS) => {
    const group = groupRef.current;
    if (group === null) return;
    if (props.following) isSettlingRef.current = true;
    const hidden =
      props.wall !== undefined &&
      isWallHidden({ segment: props.wall, cameraM: state.camera.position });
    if (group.visible === hidden) shadowCasters.isStale = true;
    group.visible = !hidden;
    isHiddenRef.current = hidden || waitingForLoadIn;
    const tag = props.labelRefs.current[`tag:${props.item.id}`];
    if (tag && loadInEntry) {
      if (tag.dataset.loadInStage !== loadInEntry.kind)
        tag.dataset.loadInStage = loadInEntry.kind;
      if (
        loadInEntry.readyAtMs !== undefined &&
        tag.dataset.modelReadyAt !== String(loadInEntry.readyAtMs)
      )
        tag.dataset.modelReadyAt = String(loadInEntry.readyAtMs);
    }
    if (!isSettlingRef.current || isReducedMotion()) {
      if (
        !group.position.equals(target.position) ||
        !group.quaternion.equals(target.quaternion)
      ) {
        shadowCasters.isStale = true;
        state.invalidate();
      }
      group.position.copy(target.position);
      group.quaternion.copy(target.quaternion);
      placeLabels({
        hidden: hidden || waitingForLoadIn,
        width: state.size.width,
        height: state.size.height,
        camera: state.camera,
      });
      return;
    }
    const share = 1 - Math.exp(-followRatePerS * Math.min(deltaS, 0.1));
    group.position.lerp(target.position, share);
    group.quaternion.slerp(target.quaternion, share);
    shadowCasters.isStale = true;
    const isSettled =
      group.position.distanceTo(target.position) < settledM &&
      group.quaternion.angleTo(target.quaternion) < settledRad;
    if (isSettled && !props.following) {
      group.position.copy(target.position);
      group.quaternion.copy(target.quaternion);
      isSettlingRef.current = false;
    }
    placeLabels({
      hidden: hidden || waitingForLoadIn,
      width: state.size.width,
      height: state.size.height,
      camera: state.camera,
    });
    state.invalidate();
  });

  function placeLabels(input: {
    hidden: boolean;
    width: number;
    height: number;
    camera: Camera;
  }) {
    const group = groupRef.current;
    if (group === null) return;
    group.updateMatrixWorld();
    const matrix = group.matrixWorld;
    function toScreen(pointM: { x: number; y: number; z: number }) {
      projected
        .set(pointM.x, pointM.y, pointM.z)
        .applyMatrix4(matrix)
        .project(input.camera);
      return {
        x: ((projected.x + 1) / 2) * input.width,
        y: ((1 - projected.y) / 2) * input.height,
        isInFront: projected.z < 1,
      };
    }
    function getScreenLength(line: DimensionLine["segments"][number]) {
      const from = toScreen(line[0]);
      const to = toScreen(line[1]);
      return Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    }
    const labels = [
      {
        key: `tag:${props.item.id}`,
        pointM: { x: 0, y: box.y.max + 0.04, z: 0 },
        isLegible: props.tagged,
        isAbove: true,
      },
      ...(props.primary
        ? dimensions.map((dimension, index) => {
            const measure = dimension.segments[0];
            return {
              key: `dimension:${props.item.id}:${index}`,
              pointM: dimension.labelM,
              isLegible:
                measure !== undefined &&
                getScreenLength(measure) >= minLabelledLinePx,
              isAbove: false,
            };
          })
        : []),
    ];
    for (const label of labels) {
      const element = props.labelRefs.current[label.key];
      if (element === null || element === undefined) continue;
      const at = toScreen(label.pointM);
      const isShown = !input.hidden && at.isInFront && label.isLegible;
      element.style.display = isShown ? "block" : "none";
      element.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, ${label.isAbove ? "-100%" : "-50%"})`;
    }
  }

  const modelAssetId =
    props.item.model.kind === "asset" ? props.item.model.assetId : "";
  const pendingBox = (
    <Line
      points={edges}
      segments
      side={DoubleSide}
      dashed
      dashSize={0.03}
      gapSize={0.02}
      color={
        props.generation?.kind === "failed"
          ? props.colors.danger
          : props.generation?.kind === "generating"
            ? props.colors.accent
            : props.colors.ink
      }
      lineWidth={1}
      transparent
      opacity={0.6}
    />
  );

  return (
    <group ref={groupRef}>
      <mesh
        position={boxCentre}
        userData={{
          itemPick: !waitingForLoadIn,
          floorCovering,
          bottomYM,
          topYM,
        }}
        onPointerDown={(event) => {
          if (!isHiddenRef.current) props.onPointerDown(event);
        }}
        onPointerOver={(event) => {
          if (isHiddenRef.current) return;
          event.stopPropagation();
          props.onHoverChange(true);
        }}
        onPointerOut={() => props.onHoverChange(false)}
      >
        <boxGeometry args={boxSize} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {props.item.light !== undefined &&
        (() => {
          const emitterM = getLightEmitterLocalPosition({
            emitter: props.item.light.emitter,
            box,
            mirrored: props.item.mirrored ?? false,
          });
          const itemId = props.item.id;
          return (
            <object3D
              position={[emitterM.x, emitterM.y, emitterM.z]}
              ref={(emitter) => {
                if (emitter === null) return;
                emitters[itemId] = emitter;
                return () => {
                  if (emitters[itemId] === emitter) delete emitters[itemId];
                };
              }}
            />
          );
        })()}
      <group scale={[props.item.mirrored ? -1 : 1, 1, 1]}>
        {props.generation ? (
          <GenerationVisual
            projectId={props.projectId}
            item={props.item}
            display={props.generation}
            assetReady={props.assetReady}
            colors={props.colors}
            pendingBox={pendingBox}
            onComplete={props.onGenerationComplete}
          />
        ) : props.loadIn &&
          props.item.model.kind === "asset" &&
          loadInEntry?.assetId === props.item.model.assetId ? (
          <LoadInAsset
            key={props.item.model.assetId}
            projectId={props.projectId}
            item={props.item}
            assetId={props.item.model.assetId}
            loadIn={props.loadIn}
            colors={props.colors}
            fallback={pendingBox}
          />
        ) : props.item.model.kind === "asset" && props.assetReady ? (
          <AssetErrorBoundary
            key={props.item.model.assetId}
            fallback={pendingBox}
            onError={() =>
              clearAssetCache({
                projectId: props.projectId,
                assetId: modelAssetId,
              })
            }
          >
            <Suspense fallback={pendingBox}>
              <AssetModel
                projectId={props.projectId}
                assetId={props.item.model.assetId}
                sizeM={props.item.sizeM}
                colorAdjust={props.item.colorAdjust}
                floorCovering={floorCovering}
                castShadow={!props.item.light?.on}
                shade={
                  props.item.light && {
                    itemId: props.item.id,
                    light: props.item.light,
                    placementKind: props.item.placement.kind,
                  }
                }
              />
            </Suspense>
          </AssetErrorBoundary>
        ) : (
          pendingBox
        )}
      </group>
      {!waitingForLoadIn && (props.selected || props.hovered) && (
        <Line
          points={outline}
          segments
          color={props.selected ? props.colors.accent : props.colors.ink}
          lineWidth={1}
          transparent
          opacity={props.selected ? 1 : lineStrongOpacity}
          depthTest={false}
          renderOrder={2}
        />
      )}
      {!waitingForLoadIn &&
        props.primary &&
        dimensions.map((dimension) => (
          <group key={dimension.axis}>
            <Line
              points={dimension.segments.flatMap(([a, b]): Point[] => [
                [a.x, a.y, a.z],
                [b.x, b.y, b.z],
              ])}
              segments
              color={props.colors.accent}
              lineWidth={1}
              depthTest={false}
              renderOrder={2}
            />
          </group>
        ))}
      {props.ringShown && (
        <group>
          <Line
            points={ring}
            color={props.colors.accent}
            lineWidth={1}
            depthTest={false}
            renderOrder={2}
          />
          <mesh
            rotation={
              placementKind === "wall" ? [0, 0, 0] : [-Math.PI / 2, 0, 0]
            }
            onPointerDown={(event) => {
              if (!isHiddenRef.current) props.onRingPointerDown(event);
            }}
          >
            <torusGeometry
              args={[ringRadiusM, Math.max(0.025, ringRadiusM * 0.08), 8, 64]}
            />
            <meshBasicMaterial visible={false} />
          </mesh>
        </group>
      )}
      {props.ringShown && (
        <Line
          points={handle}
          color={props.colors.accent}
          lineWidth={2}
          depthTest={false}
          renderOrder={2}
        />
      )}
    </group>
  );
});
