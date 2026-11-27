import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { floorCoveringMaxHeightM } from "./floor-covering-max-height-m.ts";

/** Return `true` if a floor item is at most `floorCoveringMaxHeightM` tall; `false` when it is taller or not on the floor. */
export function isFloorCovering(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
}) {
  return (
    options.placementKind === "floor" &&
    options.sizeM.height <= floorCoveringMaxHeightM
  );
}
