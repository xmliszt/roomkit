import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getRoomBounds } from "../room/get-room-bounds.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";

type Bounds =
  | {
      kind: "wall";
      alongM: { min: number; max: number };
      heightM: { min: number; max: number };
    }
  | {
      kind: "horizontal";
      xM: { min: number; max: number };
      zM: { min: number; max: number };
    };

export function getItemPlacementBounds(options: {
  item: Item;
  room: Room;
}): Bounds | undefined {
  const { placement, sizeM } = options.item;
  const sin = Math.abs(Math.sin(placement.rotationRad));
  const cos = Math.abs(Math.cos(placement.rotationRad));
  switch (placement.kind) {
    case "wall": {
      const wall = getWallSegments(options.room).find(
        (segment) => segment.wall.id === placement.wallId,
      );
      if (!wall) return undefined;
      const halfWidthM = Math.min(
        wall.lengthM / 2,
        (sizeM.width * cos + sizeM.height * sin) / 2,
      );
      const halfHeightM = Math.min(
        options.room.ceilingHeightM / 2,
        (sizeM.height * cos + sizeM.width * sin) / 2,
      );
      return {
        kind: "wall",
        alongM: { min: halfWidthM, max: wall.lengthM - halfWidthM },
        heightM: {
          min: halfHeightM,
          max: options.room.ceilingHeightM - halfHeightM,
        },
      };
    }
    case "floor":
    case "ceiling": {
      const room = getRoomBounds(options.room);
      const halfWidthM = Math.min(
        (room.maxX - room.minX) / 2,
        (sizeM.width * cos + sizeM.depth * sin) / 2,
      );
      const halfDepthM = Math.min(
        (room.maxZ - room.minZ) / 2,
        (sizeM.depth * cos + sizeM.width * sin) / 2,
      );
      return {
        kind: "horizontal",
        xM: { min: room.minX + halfWidthM, max: room.maxX - halfWidthM },
        zM: { min: room.minZ + halfDepthM, max: room.maxZ - halfDepthM },
      };
    }
    default: {
      const unreachable: never = placement;
      return unreachable;
    }
  }
}
