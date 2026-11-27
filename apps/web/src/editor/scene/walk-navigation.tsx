import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { isViewportKeyTarget } from "../is-viewport-key-target.ts";
import type { CameraReport } from "./camera-report.ts";
import { createWalkBoundary } from "./create-walk-boundary.ts";
import { readOrbitCamera } from "./read-orbit-camera.ts";
import { toCameraVec3 } from "./to-camera-vec3.ts";

type WalkNavigationProps = {
  controlsRef: RefObject<CameraControls | null>;
  room: Room;
  lensMm: number;
  onReport: (report: CameraReport) => void;
};
const moveKeys = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);
const speedMPerS = 1.5;
const lookRadPerPx = 0.004;
const touchMoveMPerPx = 0.005;
const eyeHeightM = 1.6;
const minEyeHeightM = 0.9;
const maxEyeHeightM = 1.9;
const ceilingGapM = 0.1;
const walkNearM = 0.05;

function clampEyeHeight(options: { heightM: number; room: Room }) {
  return Math.min(
    maxEyeHeightM,
    options.room.ceilingHeightM - ceilingGapM,
    Math.max(minEyeHeightM, options.heightM),
  );
}

export function WalkNavigation(props: WalkNavigationProps) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const boundary = useMemo(() => createWalkBoundary(props.room), [props.room]);
  const latest = useRef({ ...props, boundary });
  const constrainRef = useRef<
    ((nextBoundary: typeof boundary) => void) | undefined
  >(undefined);
  const tickRef = useRef<(deltaS: number) => void>(() => {});
  useEffect(() => {
    latest.current = { ...props, boundary };
  });
  useFrame((_, deltaS) => tickRef.current(deltaS), -0.5);

  useEffect(() => {
    const controls = props.controlsRef.current;
    if (!controls || !(camera instanceof PerspectiveCamera)) return;
    const { position: orbitPosition, target: orbitTarget } =
      readOrbitCamera(controls);
    const orbitNear = camera.near;
    const originalCursor = domElement.style.cursor;
    const originalTouchAction = domElement.style.touchAction;
    const start = latest.current.boundary.start(orbitTarget);
    const position = new Vector3(
      start.x,
      clampEyeHeight({ heightM: eyeHeightM, room: latest.current.room }),
      start.z,
    );
    const target = new Vector3();
    let yawRad = Math.atan2(
      orbitTarget.x - orbitPosition.x,
      orbitTarget.z - orbitPosition.z,
    );
    let pitchRad = 0;
    const held = new Set<string>();
    const pointers: { [id: number]: { x: number; y: number } } = {};
    camera.near = walkNearM;
    domElement.style.cursor = "grab";
    domElement.style.touchAction = "none";
    domElement.dataset.viewportNavigation = "true";

    function report() {
      latest.current.onReport({
        kind: "walk",
        camera: {
          positionM: { x: position.x, y: position.y, z: position.z },
          targetM: { x: target.x, y: target.y, z: target.z },
        },
      });
    }
    function place() {
      target.set(
        position.x + Math.sin(yawRad) * Math.cos(pitchRad),
        position.y + Math.sin(pitchRad),
        position.z + Math.cos(yawRad) * Math.cos(pitchRad),
      );
      controls?.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false,
      );
      controls?.update(0);
      report();
      invalidate();
    }
    function move(options: {
      sidewaysM: number;
      forwardM: number;
      heightM: number;
    }) {
      const next = latest.current.boundary.move({
        from: latest.current.boundary.start(position),
        xM:
          Math.sin(yawRad) * options.forwardM -
          Math.cos(yawRad) * options.sidewaysM,
        zM:
          Math.cos(yawRad) * options.forwardM +
          Math.sin(yawRad) * options.sidewaysM,
      });
      position.set(
        next.x,
        clampEyeHeight({
          heightM: position.y + options.heightM,
          room: latest.current.room,
        }),
        next.z,
      );
      place();
    }
    function reset() {
      held.clear();
      for (const id of Object.keys(pointers)) {
        const pointerId = Number(id);
        delete pointers[pointerId];
        if (domElement.hasPointerCapture(pointerId))
          domElement.releasePointerCapture(pointerId);
      }
      domElement.style.cursor = "grab";
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        held.clear();
        return;
      }
      const key = event.key.toLowerCase();
      if (
        event.defaultPrevented ||
        !isViewportKeyTarget(event.target) ||
        !moveKeys.has(key)
      )
        return;
      event.preventDefault();
      if (event.repeat && !held.has(key)) return;
      held.add(key);
      invalidate();
    }
    function handleKeyUp(event: KeyboardEvent) {
      held.delete(event.key.toLowerCase());
      if (["Meta", "Control", "Alt"].includes(event.key)) held.clear();
    }
    function handleFocus(event: FocusEvent) {
      if (!isViewportKeyTarget(event.target)) reset();
    }
    function handleDown(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      domElement.focus();
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      domElement.setPointerCapture(event.pointerId);
      domElement.style.cursor = "grabbing";
    }
    function handleMove(event: PointerEvent) {
      const previous = pointers[event.pointerId];
      if (!previous) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      if (Object.keys(pointers).length >= 2) {
        move({
          sidewaysM: dx * touchMoveMPerPx,
          forwardM: -dy * touchMoveMPerPx,
          heightM: 0,
        });
      } else {
        yawRad -= dx * lookRadPerPx;
        pitchRad = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, pitchRad - dy * lookRadPerPx),
        );
        place();
      }
    }
    function handleUp(event: PointerEvent) {
      if (!pointers[event.pointerId]) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      delete pointers[event.pointerId];
      if (domElement.hasPointerCapture(event.pointerId))
        domElement.releasePointerCapture(event.pointerId);
      domElement.style.cursor = Object.keys(pointers).length
        ? "grabbing"
        : "grab";
    }
    function preventPointerAction(event: Event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function handleVisibility() {
      if (document.hidden) reset();
    }
    tickRef.current = (deltaS) => {
      if (!isViewportKeyTarget(document.activeElement)) {
        reset();
        return;
      }
      if (!held.size) return;
      const sideways =
        Number(held.has("d") || held.has("arrowright")) -
        Number(held.has("a") || held.has("arrowleft"));
      const forward =
        Number(held.has("w") || held.has("arrowup")) -
        Number(held.has("s") || held.has("arrowdown"));
      const height = Number(held.has("e")) - Number(held.has("q"));
      const distanceM =
        (Math.min(deltaS, 0.05) * speedMPerS) /
        Math.max(1, Math.hypot(sideways, forward, height));
      move({
        sidewaysM: sideways * distanceM,
        forwardM: forward * distanceM,
        heightM: height * distanceM,
      });
    };
    constrainRef.current = function constrain(boundary) {
      const next = boundary.start(position);
      position.set(
        next.x,
        clampEyeHeight({ heightM: position.y, room: latest.current.room }),
        next.z,
      );
      place();
    };
    place();
    domElement.addEventListener("pointerdown", handleDown, true);
    domElement.addEventListener("pointermove", handleMove, true);
    domElement.addEventListener("pointerup", handleUp, true);
    domElement.addEventListener("pointercancel", handleUp, true);
    domElement.addEventListener("lostpointercapture", handleUp, true);
    for (const type of ["click", "dblclick", "contextmenu", "wheel"])
      domElement.addEventListener(type, preventPointerAction, {
        capture: true,
        passive: false,
      });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", reset);
    window.addEventListener("focusin", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      tickRef.current = () => {};
      constrainRef.current = undefined;
      reset();
      domElement.style.cursor = originalCursor;
      domElement.style.touchAction = originalTouchAction;
      delete domElement.dataset.viewportNavigation;
      domElement.removeEventListener("pointerdown", handleDown, true);
      domElement.removeEventListener("pointermove", handleMove, true);
      domElement.removeEventListener("pointerup", handleUp, true);
      domElement.removeEventListener("pointercancel", handleUp, true);
      domElement.removeEventListener("lostpointercapture", handleUp, true);
      for (const type of ["click", "dblclick", "contextmenu", "wheel"])
        domElement.removeEventListener(type, preventPointerAction, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", reset);
      window.removeEventListener("focusin", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      camera.near = orbitNear;
      camera.updateProjectionMatrix();
      controls.setLookAt(
        orbitPosition.x,
        orbitPosition.y,
        orbitPosition.z,
        orbitTarget.x,
        orbitTarget.y,
        orbitTarget.z,
        false,
      );
      controls.update(0);
      const restored = readOrbitCamera(controls);
      latest.current.onReport({
        kind: "loaded",
        camera: {
          positionM: toCameraVec3(restored.position),
          targetM: toCameraVec3(restored.target),
        },
      });
      invalidate();
    };
  }, [props.controlsRef, camera, domElement, invalidate]);

  useEffect(() => {
    constrainRef.current?.(boundary);
  }, [boundary]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const previousFov = camera.fov;
    camera.aspect = size.width / size.height;
    camera.setFocalLength(props.lensMm);
    domElement.dataset.fov = String(camera.fov);
    invalidate();
    return () => {
      camera.fov = previousFov;
      camera.updateProjectionMatrix();
      delete domElement.dataset.fov;
    };
  }, [camera, props.lensMm, size, domElement, invalidate]);
  return null;
}
