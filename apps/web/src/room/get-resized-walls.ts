import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getRoomBounds } from "./get-room-bounds.ts";

/** Return the room's walls stretched about the centre of its bounds so the bounds measure `widthM` along x and `depthM` along z, keeping each wall's id, kind and order. */
export function getResizedWalls(options: {
  room: Room;
  widthM: number;
  depthM: number;
}) {
  const bounds = getRoomBounds(options.room);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  const scaleX = options.widthM / (bounds.maxX - bounds.minX);
  const scaleZ = options.depthM / (bounds.maxZ - bounds.minZ);
  return options.room.walls.map((wall) => ({
    ...wall,
    startM: {
      x:
        scaleX === 1
          ? wall.startM.x
          : centreX + (wall.startM.x - centreX) * scaleX,
      z:
        scaleZ === 1
          ? wall.startM.z
          : centreZ + (wall.startM.z - centreZ) * scaleZ,
    },
  }));
}
