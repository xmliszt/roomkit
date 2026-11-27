import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { type CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import { Vector3 } from "three";
import { getNudgedPlacement } from "../get-nudged-placement.ts";
import { isEditorZoomEvent } from "../is-editor-zoom-event.ts";
import { isSamePlacement } from "../is-same-placement.ts";
import { isViewportKeyTarget } from "../is-viewport-key-target.ts";
import { viewportDragThresholdPx } from "../viewport-drag-threshold.ts";

const arrowDirections: {
  [key: string]: { horizontal: number; vertical: number };
} = {
  ArrowLeft: { horizontal: -1, vertical: 0 },
  ArrowRight: { horizontal: 1, vertical: 0 },
  ArrowUp: { horizontal: 0, vertical: 1 },
  ArrowDown: { horizontal: 0, vertical: -1 },
};
const flyKeys = new Set(["w", "a", "s", "d", "q", "e"]);
const repeatDelayMs = 300;
const repeatIntervalMs = 100;

type CameraNavigationProps = {
  controlsRef: RefObject<CameraControls | null>;
  movedRef: RefObject<boolean>;
  room: Room;
  selectedItem: Item | undefined;
  snapping: boolean;
  getItem: (itemId: string) => Item | undefined;
  onPreview: (
    input: { itemId: string; placement: Placement } | undefined,
  ) => void;
  onCommit: (input: { itemId: string; placement: Placement }) => void;
};

export function CameraNavigation(props: CameraNavigationProps) {
  const latest = useRef(props);
  const tickRef = useRef<(deltaS: number) => void>(() => {});
  const domElement = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    latest.current = props;
  });
  useFrame((_, deltaS) => tickRef.current(deltaS));

  useEffect(() => {
    if (!props.controlsRef.current) return;
    const controls = props.controlsRef.current;
    const originalButtons = { ...controls.mouseButtons };
    const originalCursor = domElement.style.cursor;
    const held = new Set<string>();
    let isSpaceHeld = false;
    let isShiftHeld = false;
    let isAltHeld = false;
    let rightPress:
      | { x: number; y: number; pointerId: number; used: boolean }
      | undefined;
    let nextRepeatMs = 0;
    let burst:
      | { itemId: string; start: Placement; placement: Placement }
      | undefined;
    const forward = new Vector3();
    const right = new Vector3();
    const position = new Vector3();
    const target = new Vector3();

    function configureButtons() {
      controls.mouseButtons.left = isSpaceHeld
        ? CameraControlsImpl.ACTION.TRUCK
        : CameraControlsImpl.ACTION.ROTATE;
      controls.mouseButtons.middle = CameraControlsImpl.ACTION.TRUCK;
      controls.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK;
      domElement.style.cursor = isSpaceHeld ? "grab" : originalCursor;
    }
    function markMove() {
      latest.current.movedRef.current = true;
      invalidate();
    }
    function finishBurst() {
      if (!burst) return;
      const finished = burst;
      burst = undefined;
      latest.current.onPreview(undefined);
      if (
        !isSamePlacement({ first: finished.start, second: finished.placement })
      )
        latest.current.onCommit({
          itemId: finished.itemId,
          placement: finished.placement,
        });
    }
    function stepArrow(key: string) {
      const direction = arrowDirections[key];
      if (!direction) return;
      if (isAltHeld) {
        controls.rotate(
          (-direction.horizontal * Math.PI) / 12,
          (-direction.vertical * Math.PI) / 12,
          true,
        );
        markMove();
        return;
      }
      const selectedId = latest.current.selectedItem?.id;
      const selected = selectedId
        ? latest.current.getItem(selectedId)
        : undefined;
      if (!selected) {
        controls.truck(
          direction.horizontal * (isShiftHeld ? 1 : 0.1),
          -direction.vertical * (isShiftHeld ? 1 : 0.1),
          true,
        );
        controls.getPosition(position);
        controls.getTarget(target);
        const liftM = Math.max(0, camera.near + 0.05 - position.y);
        if (liftM > 0)
          controls.setLookAt(
            position.x,
            position.y + liftM,
            position.z,
            target.x,
            target.y + liftM,
            target.z,
            true,
          );
        markMove();
        return;
      }
      if (selected.locked) return;
      if (burst && burst.itemId !== selected.id) finishBurst();
      burst ??= {
        itemId: selected.id,
        start: selected.placement,
        placement: selected.placement,
      };
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      burst.placement = getNudgedPlacement({
        placement: burst.placement,
        widthM: selected.sizeM.width,
        room: latest.current.room,
        right,
        ...direction,
        stepM: isShiftHeld ? 0.5 : 0.05,
        isSnapping: latest.current.snapping,
      });
      latest.current.onPreview({
        itemId: burst.itemId,
        placement: burst.placement,
      });
    }
    function consumeRightPress() {
      if (!rightPress || rightPress.used) return;
      rightPress.used = true;
      domElement.dataset.viewportNavigation = "true";
    }
    function handleDown(event: PointerEvent) {
      finishBurst();
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      delete domElement.dataset.viewportNavigation;
      configureButtons();
      if (event.button === 0 && isSpaceHeld)
        domElement.dataset.viewportNavigation = "true";
      if (event.button === 2)
        rightPress = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          used: false,
        };
    }
    function endRightPress() {
      rightPress = undefined;
      for (const key of flyKeys) held.delete(key);
    }
    function handleMove(event: PointerEvent) {
      if ((event.buttons & 2) === 0) endRightPress();
      if (!rightPress || event.pointerId !== rightPress.pointerId) return;
      if (
        Math.hypot(event.clientX - rightPress.x, event.clientY - rightPress.y) <
        viewportDragThresholdPx
      ) {
        if (!rightPress.used)
          controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
        return;
      }
      consumeRightPress();
      controls.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK;
    }
    function handleUp(event: PointerEvent) {
      if (!rightPress) return;
      if (rightPress.used && event.button === 2) event.preventDefault();
      if (event.button === 2 || (event.buttons & 2) === 0) endRightPress();
    }
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
      if (domElement.dataset.viewportNavigation === "true")
        event.stopImmediatePropagation();
    }
    function releaseArrowsAndSpace() {
      finishBurst();
      for (const key of held) if (arrowDirections[key]) held.delete(key);
      isSpaceHeld = false;
      configureButtons();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Meta") releaseArrowsAndSpace();
      if (event.key === "Escape" && burst) {
        burst = undefined;
        latest.current.onPreview(undefined);
        releaseArrowsAndSpace();
        event.preventDefault();
        return;
      }
      if (
        (event.defaultPrevented && !isEditorZoomEvent(event)) ||
        !isViewportKeyTarget(event.target)
      )
        return;
      isShiftHeld = event.shiftKey;
      isAltHeld = event.altKey;
      const key = event.key.toLowerCase();
      if (
        rightPress &&
        flyKeys.has(key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        consumeRightPress();
        held.add(key);
        invalidate();
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        if (!["+", "=", "-"].includes(key) || event.altKey) return;
        event.preventDefault();
        if (!event.repeat) {
          controls.dolly(controls.distance * (key === "-" ? -0.2 : 0.2), true);
          markMove();
        }
        return;
      }
      if (event.code === "Space") {
        if (
          event.target instanceof Element &&
          event.target.closest('button, a, [role="button"]')
        )
          return;
        event.preventDefault();
        isSpaceHeld = true;
        configureButtons();
        return;
      }
      if (!arrowDirections[event.key]) return;
      event.preventDefault();
      if (!held.has(event.key)) {
        held.add(event.key);
        stepArrow(event.key);
        nextRepeatMs = performance.now() + repeatDelayMs;
      }
      invalidate();
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Meta") releaseArrowsAndSpace();
      isShiftHeld = event.shiftKey;
      isAltHeld = event.altKey;
      held.delete(event.key);
      held.delete(event.key.toLowerCase());
      if (event.code === "Space") {
        isSpaceHeld = false;
        configureButtons();
      }
      if (![...held].some((key) => arrowDirections[key])) finishBurst();
    }
    function reset() {
      finishBurst();
      held.clear();
      isSpaceHeld = false;
      rightPress = undefined;
      configureButtons();
    }
    function handleFocus(event: FocusEvent) {
      if (!isViewportKeyTarget(event.target)) reset();
    }
    function tick(deltaS: number) {
      if (!isViewportKeyTarget(document.activeElement)) {
        reset();
        return;
      }
      if (held.size === 0) return;
      const nowMs = performance.now();
      if (nowMs >= nextRepeatMs) {
        for (const key of held) if (arrowDirections[key]) stepArrow(key);
        nextRepeatMs = nowMs + repeatIntervalMs;
      }
      if (rightPress) {
        const x = Number(held.has("d")) - Number(held.has("a"));
        const y = Number(held.has("e")) - Number(held.has("q"));
        const z = Number(held.has("w")) - Number(held.has("s"));
        if (x || y || z) {
          const distanceM =
            (Math.min(deltaS, 0.05) * (isShiftHeld ? 6 : 2)) /
            Math.hypot(x, y, z);
          camera.getWorldDirection(forward);
          controls.getPosition(position);
          controls.getTarget(target);
          const movement = forward
            .clone()
            .multiplyScalar(z)
            .addScaledVector(
              new Vector3(-forward.z, 0, forward.x).normalize(),
              x,
            );
          movement.y += y;
          movement.multiplyScalar(distanceM);
          movement.y = Math.max(
            camera.near + 0.05 - Math.min(position.y, target.y),
            movement.y,
          );
          position.add(movement);
          target.add(movement);
          controls.setLookAt(
            position.x,
            position.y,
            position.z,
            target.x,
            target.y,
            target.z,
            true,
          );
          markMove();
        }
      }
      invalidate();
    }
    configureButtons();
    tickRef.current = tick;
    domElement.addEventListener("pointerdown", handleDown, true);
    domElement.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", reset);
    window.addEventListener("focusin", handleFocus);
    return () => {
      tickRef.current = () => {};
      finishBurst();
      latest.current.onPreview(undefined);
      Object.assign(controls.mouseButtons, originalButtons);
      domElement.style.cursor = originalCursor;
      delete domElement.dataset.viewportNavigation;
      domElement.removeEventListener("pointerdown", handleDown, true);
      domElement.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", reset);
      window.removeEventListener("focusin", handleFocus);
    };
  }, [props.controlsRef, domElement, camera, invalidate]);
  return null;
}
