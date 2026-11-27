import type { WallSegment } from "../../room/wall-segment.ts";
import { wallThicknessM } from "./wall-thickness-m.ts";

export function getWallEndExtensions(options: {
  segment: WallSegment;
  previous: WallSegment | undefined;
  next: WallSegment | undefined;
}) {
  function extension(neighbour: WallSegment | undefined) {
    if (!neighbour || neighbour.wall.kind === "open") return 0;
    const { direction, outward } = options.segment;
    const denominator =
      1 + outward.x * neighbour.outward.x + outward.z * neighbour.outward.z;
    if (Math.abs(denominator) < 1e-8) return 0;
    return (
      (wallThicknessM *
        (direction.x * neighbour.outward.x +
          direction.z * neighbour.outward.z)) /
      denominator
    );
  }
  return {
    startExtensionM: -extension(options.previous),
    endExtensionM: extension(options.next),
  };
}
