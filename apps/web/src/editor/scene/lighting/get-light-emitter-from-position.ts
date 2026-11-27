import type { getItemBox } from "../../../items/get-item-box.ts";
import type { Vec3 } from "../../../items/vec3.ts";

export function getLightEmitterFromPosition(options: {
  positionM: Vec3;
  box: ReturnType<typeof getItemBox>;
  mirrored: boolean;
}) {
  function fraction(axis: "x" | "y" | "z") {
    const bounds = options.box[axis];
    const value =
      (options.positionM[axis] - bounds.min) / (bounds.max - bounds.min);
    return Math.min(1, Math.max(0, value));
  }
  const x = fraction("x");
  return {
    x: options.mirrored ? 1 - x : x,
    y: fraction("y"),
    z: fraction("z"),
  };
}
