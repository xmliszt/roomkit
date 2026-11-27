import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";

/** Return the radius of the rotate ring: past the item's corners in the plane it turns in, plus a margin of at least 0.06 m. */
export function getRingRadius(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
}) {
  const across =
    options.placementKind === "wall"
      ? options.sizeM.height
      : options.sizeM.depth;
  const halfDiagonalM =
    Math.sqrt(options.sizeM.width * options.sizeM.width + across * across) / 2;
  return halfDiagonalM + Math.max(0.06, halfDiagonalM * 0.15);
}
