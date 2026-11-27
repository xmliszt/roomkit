import type { Room } from "@planner/shared/src/scene/room-schema.ts";

/** Return the smallest and largest x and z of the room's wall starts. */
export function getRoomBounds(room: Pick<Room, "walls">) {
  const xs = room.walls.map((wall) => wall.startM.x);
  const zs = room.walls.map((wall) => wall.startM.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
