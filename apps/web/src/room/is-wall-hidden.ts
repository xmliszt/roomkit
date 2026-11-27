import type { WallSegment } from "./wall-segment.ts";

/** `true` if `cameraM` is on the outer side of the wall's line; `false` when it is on the inner side. */
export function isWallHidden(options: {
  segment: WallSegment;
  cameraM: { x: number; z: number };
}) {
  const { segment, cameraM } = options;
  return (
    (cameraM.x - segment.startM.x) * segment.outward.x +
      (cameraM.z - segment.startM.z) * segment.outward.z >
    0
  );
}
