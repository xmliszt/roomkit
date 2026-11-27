import type { Vec3 } from "../../items/vec3.ts";

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** Return a copy of `vector` with each axis rounded to 0.0001 m. */
export function toCameraVec3(vector: Vec3) {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}
