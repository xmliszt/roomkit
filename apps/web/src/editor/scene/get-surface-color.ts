import type { Room } from "@planner/shared/src/scene/room-schema.ts";

const defaultColors = { floor: "#F7F5EF", ceiling: "#FCFBF9", wall: "#FCFBF9" };

/** Return the stored colour of `surfaceId`, or the default for a floor, ceiling or wall when `room.surfaces` has none. */
export function getSurfaceColor(options: { room: Room; surfaceId: string }) {
  const { room, surfaceId } = options;
  if (Object.hasOwn(room.surfaces, surfaceId)) {
    return room.surfaces[surfaceId]?.color ?? defaultColors.wall;
  }
  return surfaceId === "floor" || surfaceId === "ceiling"
    ? defaultColors[surfaceId]
    : defaultColors.wall;
}
