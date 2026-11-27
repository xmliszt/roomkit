import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";

/** Return `true` if a floor item is at most 0.03 m tall; `false` when it is taller or not on the floor. */
export function isFloorCovering(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
}) {
  return options.placementKind === "floor" && options.sizeM.height <= 0.03;
}
