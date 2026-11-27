import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { WallSegment } from "./wall-segment.ts";

/** Return each wall of `room` as a segment from its start to the next wall's start, with its unit direction and the unit normal that points out of the room. */
export function getWallSegments(room: Pick<Room, "walls">) {
  return room.walls.map((wall, index): WallSegment => {
    const next = room.walls[(index + 1) % room.walls.length] ?? wall;
    const dx = next.startM.x - wall.startM.x;
    const dz = next.startM.z - wall.startM.z;
    const lengthM = Math.sqrt(dx * dx + dz * dz);
    const direction = { x: dx / lengthM, z: dz / lengthM };
    return {
      wall,
      startM: wall.startM,
      endM: next.startM,
      lengthM,
      direction,
      outward: { x: -direction.z, z: direction.x },
    };
  });
}
