import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { WallSegment } from "../room/wall-segment.ts";
import { snapToGrid } from "./snap-to-grid.ts";

/** Return a wall placement at `heightM` on the wall of `segments` closest to `focusM`, at the point of that wall nearest `focusM`, kept `widthM / 2` inside its ends and snapped to 0.05 m; `undefined` when `segments` is empty. */
export function getCatalogWallPlacement(options: {
  segments: WallSegment[];
  focusM: { x: number; z: number };
  widthM: number;
  heightM: number;
}): Extract<Placement, { kind: "wall" }> | undefined {
  const closest = options.segments
    .map((segment) => {
      const alongM = Math.min(
        segment.lengthM,
        Math.max(
          0,
          (options.focusM.x - segment.startM.x) * segment.direction.x +
            (options.focusM.z - segment.startM.z) * segment.direction.z,
        ),
      );
      const dx =
        segment.startM.x + segment.direction.x * alongM - options.focusM.x;
      const dz =
        segment.startM.z + segment.direction.z * alongM - options.focusM.z;
      return { segment, alongM, distanceM: Math.sqrt(dx * dx + dz * dz) };
    })
    .toSorted((a, b) => a.distanceM - b.distanceM)
    .at(0);
  if (closest === undefined) return undefined;
  const marginM = Math.min(options.widthM / 2, closest.segment.lengthM / 2);
  return {
    kind: "wall",
    wallId: closest.segment.wall.id,
    alongM: Math.min(
      Math.floor((closest.segment.lengthM - marginM) * 20) / 20,
      Math.max(Math.ceil(marginM * 20) / 20, snapToGrid(closest.alongM)),
    ),
    heightM: options.heightM,
    rotationRad: 0,
  };
}
