import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";

export function isSamePlacement(options: {
  first: Placement;
  second: Placement;
}) {
  const { first, second } = options;
  if (first.rotationRad !== second.rotationRad) return false;
  switch (first.kind) {
    case "floor":
      return (
        second.kind === "floor" &&
        first.xM === second.xM &&
        first.zM === second.zM &&
        first.elevationM === second.elevationM
      );
    case "ceiling":
      return (
        second.kind === "ceiling" &&
        first.xM === second.xM &&
        first.zM === second.zM
      );
    case "wall":
      return (
        second.kind === "wall" &&
        first.wallId === second.wallId &&
        first.alongM === second.alongM &&
        first.heightM === second.heightM
      );
    default: {
      const unreachable: never = first;
      return unreachable;
    }
  }
}
