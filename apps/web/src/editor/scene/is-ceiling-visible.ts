import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { Vec3 } from "@planner/shared/src/scene/vec3-schema.ts";

/** `true` if the camera is below the ceiling, where its underside can be in view; `false` when the camera is at or above it. */
export function isCeilingVisible(options: { room: Room; cameraM: Vec3 }) {
  return options.cameraM.y < options.room.ceilingHeightM;
}
