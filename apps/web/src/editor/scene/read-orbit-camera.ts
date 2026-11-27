import type { CameraControls } from "@react-three/drei";
import { Vector3 } from "three";

/** Return the camera's current position and target, mid-transition included, not the transition's destination. */
export function readOrbitCamera(controls: CameraControls) {
  return {
    position: controls.getPosition(new Vector3(), false),
    target: controls.getTarget(new Vector3(), false),
  };
}
