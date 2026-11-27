import type { WallSegment } from "../room/wall-segment.ts";
import { getRayPlaneHit } from "./get-ray-plane-hit.ts";
import type { Ray } from "./ray.ts";

/** Return where `ray` meets the plane of each wall in `segments`, nearest first, in wall-local numbers; `isOnWall` is `true` when the hit lies within the wall's length and between the floor and `ceilingHeightM`. */
export function getWallHits(options: {
  ray: Ray;
  segments: WallSegment[];
  ceilingHeightM: number;
}) {
  return options.segments
    .flatMap((segment) => {
      const pointM = getRayPlaneHit({
        ray: options.ray,
        pointM: { x: segment.startM.x, y: 0, z: segment.startM.z },
        normal: { x: segment.outward.x, y: 0, z: segment.outward.z },
      });
      if (pointM === undefined) return [];
      const alongM =
        (pointM.x - segment.startM.x) * segment.direction.x +
        (pointM.z - segment.startM.z) * segment.direction.z;
      const dx = pointM.x - options.ray.originM.x;
      const dy = pointM.y - options.ray.originM.y;
      const dz = pointM.z - options.ray.originM.z;
      return [
        {
          wallId: segment.wall.id,
          alongM,
          heightM: pointM.y,
          distanceM: Math.sqrt(dx * dx + dy * dy + dz * dz),
          isOnWall:
            alongM >= 0 &&
            alongM <= segment.lengthM &&
            pointM.y >= 0 &&
            pointM.y <= options.ceilingHeightM,
        },
      ];
    })
    .toSorted((a, b) => a.distanceM - b.distanceM);
}
