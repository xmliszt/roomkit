import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";

/** Return the item's box in its own frame: the anchor is the bottom centre of a floor item, the back centre of a wall item and the top centre of a ceiling item. */
export function getItemBox(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
}) {
  const { width, height, depth } = options.sizeM;
  const x = { min: -width / 2, max: width / 2 };
  switch (options.placementKind) {
    case "floor":
      return {
        x,
        y: { min: 0, max: height },
        z: { min: -depth / 2, max: depth / 2 },
      };
    case "wall":
      return {
        x,
        y: { min: -height / 2, max: height / 2 },
        z: { min: 0, max: depth },
      };
    case "ceiling":
      return {
        x,
        y: { min: -height, max: 0 },
        z: { min: -depth / 2, max: depth / 2 },
      };
    default: {
      const unreachable: never = options.placementKind;
      return unreachable;
    }
  }
}
