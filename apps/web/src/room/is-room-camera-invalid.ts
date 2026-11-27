import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getWallSegments } from "./get-wall-segments.ts";
import { isInsidePolygon } from "./is-inside-polygon.ts";

export function isRoomCameraInvalid(options: { room: Room; camera: Camera }) {
  if (options.camera.positionM.y < 0) return true;
  const polygon = options.room.walls.map((wall) => wall.startM);
  const target = options.camera.targetM;
  const isTargetOnWall = getWallSegments(options.room).some((segment) => {
    const dx = target.x - segment.startM.x;
    const dz = target.z - segment.startM.z;
    const alongM = dx * segment.direction.x + dz * segment.direction.z;
    const distanceM = dx * segment.outward.x + dz * segment.outward.z;
    return (
      Math.abs(distanceM) < 1e-6 && alongM >= 0 && alongM <= segment.lengthM
    );
  });
  return !isTargetOnWall && !isInsidePolygon({ point: target, polygon });
}
