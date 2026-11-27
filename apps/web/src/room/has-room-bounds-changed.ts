import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getRoomBounds } from "./get-room-bounds.ts";

const roundingTolerance = Number.EPSILON * 8;

export function hasRoomBoundsChanged(options: {
  previous: Room;
  current: Room;
}) {
  const previous = getRoomBounds(options.previous);
  const current = getRoomBounds(options.current);
  const centerShiftM = Math.hypot(
    (current.minX + current.maxX - previous.minX - previous.maxX) / 2,
    (current.minZ + current.maxZ - previous.minZ - previous.maxZ) / 2,
  );
  const previousWidthM = previous.maxX - previous.minX;
  const previousDepthM = previous.maxZ - previous.minZ;
  return (
    centerShiftM > 0.5 + roundingTolerance ||
    Math.abs(current.maxX - current.minX - previousWidthM) >
      previousWidthM * (0.2 + roundingTolerance) ||
    Math.abs(current.maxZ - current.minZ - previousDepthM) >
      previousDepthM * (0.2 + roundingTolerance)
  );
}
