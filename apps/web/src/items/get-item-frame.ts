import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { WallSegment } from "../room/wall-segment.ts";
import type { ItemFrame } from "./item-frame.ts";

/** Return the world position and turn of the anchor of an item placed at `placement`, or `undefined` when a wall placement names a wall not in `segments`. A wall item faces into the room and turns about the wall's inward normal. */
export function getItemFrame(options: {
  placement: Placement;
  segments: WallSegment[];
  ceilingHeightM: number;
}): ItemFrame | undefined {
  const { placement } = options;
  switch (placement.kind) {
    case "floor":
      return {
        positionM: {
          x: placement.xM,
          y: placement.elevationM,
          z: placement.zM,
        },
        yawRad: placement.rotationRad,
        rollRad: 0,
      };
    case "ceiling":
      return {
        positionM: {
          x: placement.xM,
          y: options.ceilingHeightM,
          z: placement.zM,
        },
        yawRad: placement.rotationRad,
        rollRad: 0,
      };
    case "wall": {
      const segment = options.segments.find(
        (candidate) => candidate.wall.id === placement.wallId,
      );
      if (segment === undefined) return undefined;
      return {
        positionM: {
          x: segment.startM.x + segment.direction.x * placement.alongM,
          y: placement.heightM,
          z: segment.startM.z + segment.direction.z * placement.alongM,
        },
        yawRad: Math.atan2(-segment.outward.x, -segment.outward.z),
        rollRad: placement.rotationRad,
      };
    }
    default: {
      const unreachable: never = placement;
      return unreachable;
    }
  }
}
