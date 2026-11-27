import type { CameraControls } from "@react-three/drei";
import { Vector3 } from "three";
import type { CameraReport } from "./camera-report.ts";
import { toCameraVec3 } from "./to-camera-vec3.ts";

/** Return handlers that report an unsaved orbit move's destination as `moved` once it settles or on `flush`, and never while `isWalking()` is `true`. */
export function createOrbitMoveReporter(options: {
  controls: CameraControls;
  movedRef: { current: boolean };
  isWalking: () => boolean;
  delayMs: number;
  onReport: (report: CameraReport) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }
  function flush() {
    cancel();
    if (!options.movedRef.current || options.isWalking()) return;
    options.movedRef.current = false;
    options.onReport({
      kind: "moved",
      camera: {
        positionM: toCameraVec3(options.controls.getPosition(new Vector3())),
        targetM: toCameraVec3(options.controls.getTarget(new Vector3())),
      },
    });
  }
  function startMove() {
    if (options.isWalking()) return;
    options.movedRef.current = true;
    cancel();
  }
  function scheduleReport() {
    if (!options.movedRef.current) return;
    cancel();
    timer = setTimeout(flush, options.delayMs);
  }
  return { startMove, scheduleReport, cancel, flush };
}
