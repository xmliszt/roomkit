import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { getItemBox } from "../../../items/get-item-box.ts";

/** Return the bulb position in the item's own frame, reading each `emitter` fraction from the box's minimum to its maximum, with x read from the far side when `mirrored`. */
export function getLightEmitterLocalPosition(options: {
  emitter: Light["emitter"];
  box: ReturnType<typeof getItemBox>;
  mirrored: boolean;
}) {
  const { emitter, box } = options;
  const xFraction = options.mirrored ? 1 - emitter.x : emitter.x;
  return {
    x: box.x.min + xFraction * (box.x.max - box.x.min),
    y: box.y.min + emitter.y * (box.y.max - box.y.min),
    z: box.z.min + emitter.z * (box.z.max - box.z.min),
  };
}
