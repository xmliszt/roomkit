import type { Ray } from "./ray.ts";
import type { Vec3 } from "./vec3.ts";

/** Return where `ray` meets the plane through `pointM` with normal `normal`, or `undefined` when it runs parallel to the plane or meets it behind its origin. */
export function getRayPlaneHit(options: {
  ray: Ray;
  pointM: Vec3;
  normal: Vec3;
}): Vec3 | undefined {
  const { ray, pointM, normal } = options;
  const facing =
    ray.direction.x * normal.x +
    ray.direction.y * normal.y +
    ray.direction.z * normal.z;
  if (Math.abs(facing) < 1e-9) return undefined;
  const distance =
    ((pointM.x - ray.originM.x) * normal.x +
      (pointM.y - ray.originM.y) * normal.y +
      (pointM.z - ray.originM.z) * normal.z) /
    facing;
  if (distance <= 0) return undefined;
  return {
    x: ray.originM.x + ray.direction.x * distance,
    y: ray.originM.y + ray.direction.y * distance,
    z: ray.originM.z + ray.direction.z * distance,
  };
}
