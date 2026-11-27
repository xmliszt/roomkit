import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Euler,
  Frustum,
  Matrix4,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import { ItemHoverContext } from "../../chat/item-hover-context.ts";
import { getDraggedPlacement } from "../../items/get-dragged-placement.ts";
import { getGrabOffset } from "../../items/get-grab-offset.ts";
import { getRayPlaneHit } from "../../items/get-ray-plane-hit.ts";
import { getRingAngle } from "../../items/get-ring-angle.ts";
import { getTurnedRotation } from "../../items/get-turned-rotation.ts";
import { getWallHits } from "../../items/get-wall-hits.ts";
import type { GrabOffset } from "../../items/grab-offset.ts";
import type { ItemFrame } from "../../items/item-frame.ts";
import type { Ray } from "../../items/ray.ts";
import type { SurfaceHit } from "../../items/surface-hit.ts";
import type { Vec3 } from "../../items/vec3.ts";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { isWallHidden } from "../../room/is-wall-hidden.ts";
import type { getGenerationDisplays } from "../generation/get-generation-displays.ts";
import { getGroupPlacementCommands } from "../get-group-placement-commands.ts";
import { isSamePlacement } from "../is-same-placement.ts";
import type { ItemSelection } from "../item-selection.ts";
import type { createLoadIn } from "../load-in/create-load-in.ts";
import type { Tool } from "../tool.ts";
import { viewportDragThresholdPx } from "../viewport-drag-threshold.ts";
import { getItemRenderLayout } from "./get-item-render-layout.ts";
import { orderFloorCoveringHits } from "./order-floor-covering-hits.ts";
import { SceneItem } from "./scene-item.tsx";
import { useTokenColors } from "./use-token-colors.ts";

type Gesture =
  | {
      kind: "move";
      itemId: string;
      start: Placement;
      offset: GrabOffset;
      planeYM: number;
      pointerX: number;
      pointerY: number;
    }
  | {
      kind: "turn";
      itemId: string;
      start: Placement;
      frame: ItemFrame;
      startAngleRad: number;
    };

type ItemsLayerProps = {
  bulbPreview: { itemId: string; emitter: Light["emitter"] } | undefined;
  loadIn: ReturnType<typeof createLoadIn> | undefined;
  onOpeningPreview: (
    preview: { itemId: string; placement: Placement } | undefined,
  ) => void;
  projectId: string;
  items: Item[];
  room: Room;
  labelsShown: boolean;
  snapping: boolean;
  tool: Tool;
  selectedItemId: string | undefined;
  selectedItemIds: readonly string[];
  onPreview: (
    input: { itemId: string; placement: Placement } | undefined,
  ) => void;
  unconfirmedItemIds: readonly string[];
  generations: ReturnType<typeof getGenerationDisplays>;
  onGenerationComplete: (itemId: string) => void;
  labelRefs: RefObject<{ [key: string]: HTMLElement | null }>;
  onSelect: (selection: ItemSelection) => void;
  onContextPointerDown: (input: {
    itemId: string;
    event: PointerEvent;
  }) => void;
  onCommit: (input: { itemId: string; placement: Placement }) => void;
};

function toVec3(vector: { x: number; y: number; z: number }): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function ItemsLayer(props: ItemsLayerProps) {
  const colors = useTokenColors();
  const reduced = useReducedMotion() === true;
  const frustum = useMemo(() => new Frustum(), []);
  const projection = useMemo(() => new Matrix4(), []);
  const visibilitySphere = useMemo(() => new Sphere(), []);
  const segments = useMemo(() => getWallSegments(props.room), [props.room]);
  const itemsById = useMemo(
    () => Object.fromEntries(props.items.map((item) => [item.id, item])),
    [props.items],
  );
  const layouts = useMemo(
    () =>
      Object.fromEntries(
        props.items.map((item) => {
          const layout = getItemRenderLayout({
            item,
            segments,
            ceilingHeightM: props.room.ceilingHeightM,
          });
          if (!layout) return [item.id, undefined];
          const { frame, box, sizeM } = layout;
          const centerM = new Vector3(
            (box.x.min + box.x.max) / 2,
            (box.y.min + box.y.max) / 2,
            (box.z.min + box.z.max) / 2,
          ).applyEuler(new Euler(0, frame.yawRad, frame.rollRad, "YXZ"));
          centerM.x += frame.positionM.x;
          centerM.y += frame.positionM.y;
          centerM.z += frame.positionM.z;
          const wall =
            item.placement.kind === "wall"
              ? segments.find(
                  (segment) =>
                    item.placement.kind === "wall" &&
                    segment.wall.id === item.placement.wallId,
                )
              : undefined;
          return [
            item.id,
            {
              ...layout,
              item: { ...item, sizeM },
              wall,
              centerM,
              radiusM: Math.max(
                0.3,
                (Math.hypot(sizeM.width, sizeM.height, sizeM.depth) / 2) * 1.3,
              ),
            },
          ];
        }),
      ),
    [props.items, segments, props.room.ceilingHeightM],
  );
  const generationsByItem = useMemo(
    () =>
      Object.fromEntries(
        props.generations.map((generation) => {
          const item = itemsById[generation.itemId];
          const sizeM = layouts[generation.itemId]?.sizeM;
          return [
            generation.itemId,
            item?.cutsOpening && sizeM
              ? {
                  ...generation,
                  sizeM: {
                    ...generation.sizeM,
                    depth: Math.min(generation.sizeM.depth, sizeM.depth),
                  },
                }
              : generation,
          ];
        }),
      ),
    [props.generations, itemsById, layouts],
  );
  const handlersRef = useRef({
    itemsById,
    layouts,
    handleItemPointerDown,
    handleRingPointerDown,
    onGenerationComplete: props.onGenerationComplete,
  });
  handlersRef.current = {
    itemsById,
    layouts,
    handleItemPointerDown,
    handleRingPointerDown,
    onGenerationComplete: props.onGenerationComplete,
  };
  const callbacksRef = useRef<{
    [itemId: string]: Pick<
      ComponentProps<typeof SceneItem>,
      | "onPointerDown"
      | "onRingPointerDown"
      | "onHoverChange"
      | "onGenerationComplete"
    >;
  }>({});

  useEffect(() => {
    callbacksRef.current = Object.fromEntries(
      Object.entries(callbacksRef.current).filter(([itemId]) =>
        Object.hasOwn(itemsById, itemId),
      ),
    );
  }, [itemsById]);

  function getCallbacks(itemId: string) {
    const stored = Object.hasOwn(callbacksRef.current, itemId)
      ? callbacksRef.current[itemId]
      : undefined;
    if (stored) return stored;
    const callbacks = {
      onPointerDown(event: ThreeEvent<PointerEvent>) {
        const current = handlersRef.current;
        const item = Object.hasOwn(current.itemsById, itemId)
          ? current.itemsById[itemId]
          : undefined;
        if (item) current.handleItemPointerDown({ item, event });
      },
      onRingPointerDown(event: ThreeEvent<PointerEvent>) {
        const current = handlersRef.current;
        const item = Object.hasOwn(current.itemsById, itemId)
          ? current.itemsById[itemId]
          : undefined;
        const frame = Object.hasOwn(current.layouts, itemId)
          ? current.layouts[itemId]?.frame
          : undefined;
        if (item && frame)
          current.handleRingPointerDown({ item, frame, event });
      },
      onHoverChange(isHovered: boolean) {
        setHoveredItemId((current) =>
          isHovered ? itemId : current === itemId ? undefined : current,
        );
      },
      onGenerationComplete() {
        handlersRef.current.onGenerationComplete(itemId);
      },
    };
    Object.defineProperty(callbacksRef.current, itemId, {
      value: callbacks,
      configurable: true,
      enumerable: true,
    });
    return callbacks;
  }

  useFrame((state) => {
    if (!props.loadIn?.getUnfinished().size) return;
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(
        state.camera.projectionMatrix,
        state.camera.matrixWorldInverse,
      ),
    );
    const visible: { itemId: string; distanceM: number }[] = [];
    for (const itemId of props.loadIn.getUnfinished()) {
      const layout = Object.hasOwn(layouts, itemId)
        ? layouts[itemId]
        : undefined;
      if (!layout) {
        props.loadIn.complete(itemId);
        continue;
      }
      if (
        layout.wall &&
        isWallHidden({ segment: layout.wall, cameraM: state.camera.position })
      )
        continue;
      visibilitySphere.center.copy(layout.centerM);
      visibilitySphere.radius = layout.radiusM;
      if (frustum.intersectsSphere(visibilitySphere))
        visible.push({
          itemId,
          distanceM: layout.centerM.distanceTo(state.camera.position),
        });
    }
    props.loadIn.advance({
      nowMs: performance.now(),
      reduced,
      itemsById,
      visible,
    });
    if (
      [...props.loadIn.getUnfinished()].some(
        (id) => props.loadIn?.getEntry(id)?.kind === "appearing",
      ) ||
      visible.some(
        ({ itemId }) => props.loadIn?.getEntry(itemId)?.kind === "waiting",
      )
    )
      state.invalidate();
  });
  const hoveredChatItemId = useContext(ItemHoverContext);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const getState = useThree((state) => state.get);
  const setEvents = useThree((state) => state.setEvents);
  const [preview, setPreview] = useState<{
    itemId: string;
    placement: Placement;
  }>();
  const [hoveredItemId, setHoveredItemId] = useState<string | undefined>(
    undefined,
  );
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const snappingRef = useRef(props.snapping);
  const raycaster = useMemo(() => new Raycaster(), []);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    const previous = getState().events.filter ?? ((hits) => hits);
    setEvents({ filter: orderFloorCoveringHits });
    return () => setEvents({ filter: previous });
  }, [getState, setEvents]);

  useEffect(() => {
    snappingRef.current = props.snapping;
  }, [props.snapping]);

  function setControlsEnabled(isEnabled: boolean) {
    if (controls !== null && "enabled" in controls) {
      controls.enabled = isEnabled;
    }
  }

  function getRay(event: PointerEvent): Ray {
    const rect = domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return {
      originM: toVec3(raycaster.ray.origin),
      direction: toVec3(raycaster.ray.direction),
    };
  }

  function getMountedWalls() {
    return segments.filter((segment) => segment.wall.kind !== "open");
  }

  function getSurfaceHit(input: {
    ray: Ray;
    placement: Placement;
    planeYM: number;
  }): SurfaceHit | undefined {
    const { placement } = input;
    if (placement.kind !== "wall") {
      const pointM = getRayPlaneHit({
        ray: input.ray,
        pointM: { x: 0, y: input.planeYM, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
      });
      return pointM === undefined
        ? undefined
        : { kind: "horizontal", xM: pointM.x, zM: pointM.z };
    }
    const hits = getWallHits({
      ray: input.ray,
      segments: getMountedWalls().filter(
        (segment) =>
          segment.wall.id === placement.wallId ||
          !isWallHidden({ segment, cameraM: camera.position }),
      ),
      ceilingHeightM: props.room.ceilingHeightM,
    });
    const hit =
      hits.find((candidate) => candidate.isOnWall) ??
      hits.find((candidate) => candidate.wallId === placement.wallId);
    return hit === undefined
      ? undefined
      : {
          kind: "wall",
          wallId: hit.wallId,
          alongM: hit.alongM,
          heightM: hit.heightM,
        };
  }

  function follow(input: { gesture: Gesture; pointerId: number }) {
    const { gesture } = input;
    const isGroupGesture =
      props.selectedItemIds.length > 1 &&
      props.selectedItemIds.includes(gesture.itemId);
    const opening =
      !isGroupGesture &&
      props.items.some(
        (item) =>
          item.id === gesture.itemId && item.cutsOpening && !item.locked,
      );
    let latest: Placement = gesture.start;
    let isMoving = gesture.kind === "turn";
    function handleMove(event: PointerEvent) {
      if (event.pointerId !== input.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finish();
        return;
      }
      if (gesture.kind === "move" && !isMoving) {
        const dx = event.clientX - gesture.pointerX;
        const dy = event.clientY - gesture.pointerY;
        if (Math.sqrt(dx * dx + dy * dy) < viewportDragThresholdPx) return;
        isMoving = true;
      }
      const ray = getRay(event);
      const next = (() => {
        switch (gesture.kind) {
          case "move": {
            const hit = getSurfaceHit({
              ray,
              placement: latest,
              planeYM: gesture.planeYM,
            });
            return hit === undefined
              ? undefined
              : getDraggedPlacement({
                  placement: gesture.start,
                  hit,
                  offset: gesture.offset,
                  isSnapping: snappingRef.current !== event.altKey,
                });
          }
          case "turn": {
            const pointM = getRayPlaneHit({
              ray,
              pointM: gesture.frame.positionM,
              normal: getSurfaceNormal({
                frame: gesture.frame,
                placement: gesture.start,
              }),
            });
            if (pointM === undefined) return undefined;
            return {
              ...gesture.start,
              rotationRad: getTurnedRotation({
                startRad: gesture.start.rotationRad,
                startAngleRad: gesture.startAngleRad,
                angleRad: getRingAngle({
                  placementKind: gesture.start.kind,
                  anchorM: gesture.frame.positionM,
                  yawRad: gesture.frame.yawRad,
                  pointM,
                }),
                isSnapping: snappingRef.current !== event.altKey,
              }),
            };
          }
          default: {
            const unreachable: never = gesture;
            return unreachable;
          }
        }
      })();
      if (next === undefined) return;
      const placement = (() => {
        if (isGroupGesture) return next;
        const command = getGroupPlacementCommands({
          items: props.items,
          selectedIds: [gesture.itemId],
          itemId: gesture.itemId,
          placement: next,
          room: props.room,
        }).find(
          (command) =>
            command.type === "item.update" && command.itemId === gesture.itemId,
        );
        return command?.type === "item.update"
          ? (command.patch.placement ?? gesture.start)
          : gesture.start;
      })();
      latest = placement;
      const nextPreview = { itemId: gesture.itemId, placement };
      setPreview(nextPreview);
      if (isGroupGesture) props.onPreview(nextPreview);
      if (opening) props.onOpeningPreview(nextPreview);
      invalidate();
    }
    function stop() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleCancel, true);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("pointerdown", handleUp, true);
      cleanupRef.current = undefined;
      setControlsEnabled(true);
      setPreview(undefined);
      if (isGroupGesture) props.onPreview(undefined);
      if (opening) props.onOpeningPreview(undefined);
    }
    function handleUp(event: PointerEvent) {
      if (event.pointerId === input.pointerId) finish();
    }
    function finish() {
      stop();
      if (
        isMoving &&
        !isSamePlacement({ first: latest, second: gesture.start })
      ) {
        props.onCommit({ itemId: gesture.itemId, placement: latest });
      } else if (!isMoving && gesture.kind === "move") {
        props.onSelect({ kind: "replace", itemId: gesture.itemId });
      }
    }
    function handleCancel(event: Event) {
      if (event instanceof PointerEvent && event.pointerId !== input.pointerId)
        return;
      stop();
    }
    cleanupRef.current?.();
    setControlsEnabled(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("pointerdown", handleUp, true);
    cleanupRef.current = stop;
  }

  function handleItemPointerDown(input: {
    item: Item;
    event: ThreeEvent<PointerEvent>;
  }) {
    const { item, event } = input;
    if (
      event.button === 2 ||
      (event.button === 0 && event.ctrlKey && /Mac/i.test(navigator.platform))
    ) {
      event.stopPropagation();
      props.onContextPointerDown({ itemId: item.id, event: event.nativeEvent });
      return;
    }
    if (event.button !== 0 || domElement.dataset.viewportNavigation === "true")
      return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      props.onSelect({ kind: "toggle", itemId: item.id });
      return;
    }
    props.onSelect({ kind: "keep-set", itemId: item.id });
    if (props.tool === "rotate" || item.locked) {
      props.onSelect({ kind: "replace", itemId: item.id });
      return;
    }
    const placement = item.placement;
    const hit: SurfaceHit | undefined = (() => {
      if (placement.kind !== "wall") {
        return { kind: "horizontal", xM: event.point.x, zM: event.point.z };
      }
      const segment = segments.find(
        (candidate) => candidate.wall.id === placement.wallId,
      );
      if (segment === undefined) return undefined;
      return {
        kind: "wall",
        wallId: placement.wallId,
        alongM:
          (event.point.x - segment.startM.x) * segment.direction.x +
          (event.point.z - segment.startM.z) * segment.direction.z,
        heightM: event.point.y,
      };
    })();
    const offset =
      hit === undefined ? undefined : getGrabOffset({ placement, hit });
    if (offset === undefined) return;
    follow({
      gesture: {
        kind: "move",
        itemId: item.id,
        start: placement,
        offset,
        planeYM: event.point.y,
        pointerX: event.nativeEvent.clientX,
        pointerY: event.nativeEvent.clientY,
      },
      pointerId: event.pointerId,
    });
  }

  function handleRingPointerDown(input: {
    item: Item;
    frame: ItemFrame;
    event: ThreeEvent<PointerEvent>;
  }) {
    const { item, frame, event } = input;
    if (
      event.button !== 0 ||
      (item.locked && props.selectedItemIds.length < 2) ||
      domElement.dataset.viewportNavigation === "true"
    )
      return;
    event.stopPropagation();
    const pointM = getRayPlaneHit({
      ray: {
        originM: toVec3(event.ray.origin),
        direction: toVec3(event.ray.direction),
      },
      pointM: frame.positionM,
      normal: getSurfaceNormal({ frame, placement: item.placement }),
    });
    if (pointM === undefined) return;
    follow({
      gesture: {
        kind: "turn",
        itemId: item.id,
        start: item.placement,
        frame,
        startAngleRad: getRingAngle({
          placementKind: item.placement.kind,
          anchorM: frame.positionM,
          yawRad: frame.yawRad,
          pointM,
        }),
      },
      pointerId: event.pointerId,
    });
  }

  return (
    <group>
      {props.items.map((item) => {
        const isLocalPreview =
          preview?.itemId === item.id &&
          !item.locked &&
          !(
            props.selectedItemIds.length > 1 &&
            props.selectedItemIds.includes(item.id)
          );
        const placement = isLocalPreview ? preview.placement : item.placement;
        const layout = isLocalPreview
          ? getItemRenderLayout({
              item: { ...item, placement },
              segments,
              ceilingHeightM: props.room.ceilingHeightM,
            })
          : layouts[item.id];
        if (layout === undefined) return null;
        const { frame, sizeM } = layout;
        const wall =
          placement.kind === "wall"
            ? segments.find((segment) => segment.wall.id === placement.wallId)
            : undefined;
        const renderedItem = isLocalPreview
          ? { ...item, placement, sizeM }
          : (layouts[item.id]?.item ?? item);
        const bulbItem =
          props.bulbPreview?.itemId === item.id && renderedItem.light
            ? {
                ...renderedItem,
                light: {
                  ...renderedItem.light,
                  emitter: props.bulbPreview.emitter,
                },
              }
            : renderedItem;
        const isSelected = props.selectedItemId === item.id;
        return (
          <SceneItem
            key={item.id}
            loadIn={props.loadIn}
            projectId={props.projectId}
            item={bulbItem}
            frame={frame}
            wall={wall}
            selected={props.selectedItemIds.includes(item.id)}
            primary={isSelected}
            hovered={hoveredItemId === item.id || hoveredChatItemId === item.id}
            ringShown={isSelected && props.tool === "rotate"}
            following={!item.cutsOpening && isLocalPreview}
            assetReady={!props.unconfirmedItemIds.includes(item.id)}
            tagged={
              props.labelsShown || isSelected || hoveredItemId === item.id
            }
            generation={
              Object.hasOwn(generationsByItem, item.id)
                ? generationsByItem[item.id]
                : undefined
            }
            {...getCallbacks(item.id)}
            labelRefs={props.labelRefs}
            colors={colors}
          />
        );
      })}
    </group>
  );
}

function getSurfaceNormal(options: {
  frame: ItemFrame;
  placement: Placement;
}): Vec3 {
  if (options.placement.kind !== "wall") return { x: 0, y: 1, z: 0 };
  return {
    x: Math.sin(options.frame.yawRad),
    y: 0,
    z: Math.cos(options.frame.yawRad),
  };
}
