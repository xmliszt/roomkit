import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getRoomBounds } from "./get-room-bounds.ts";

/** `true` if `camera` equals the camera `createRectangularScene` returns for a room of this bounding size; `false` when it differs. */
export function isGeneratedCamera(options: { room: Room; camera: Camera }) {
  const bounds = getRoomBounds(options.room);
  const generated = createRectangularScene({
    widthM: bounds.maxX - bounds.minX,
    depthM: bounds.maxZ - bounds.minZ,
    ceilingHeightM: options.room.ceilingHeightM,
  }).camera;
  return JSON.stringify(generated) === JSON.stringify(options.camera);
}
