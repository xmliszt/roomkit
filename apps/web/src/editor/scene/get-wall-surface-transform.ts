import type { WallSegment } from "../../room/wall-segment.ts";

export function getWallSurfaceTransform(options: {
  segment: WallSegment;
  heightM: number;
}) {
  const { segment } = options;
  return {
    position: [
      (segment.startM.x + segment.endM.x) / 2,
      options.heightM / 2,
      (segment.startM.z + segment.endM.z) / 2,
    ] satisfies [number, number, number],
    rotationY: Math.atan2(-segment.outward.x, -segment.outward.z),
  };
}
