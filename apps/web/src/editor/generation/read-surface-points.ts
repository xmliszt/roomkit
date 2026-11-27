import { GENERATION_POINTS } from "./appearance-timing.ts";

export function readSurfacePoints(buffer: ArrayBuffer) {
  if (buffer.byteLength !== 8000 * 6 * 4)
    throw new Error("Invalid surface points");
  const data = new DataView(buffer);
  const positions = new Float32Array(GENERATION_POINTS.count * 3);
  const colors = new Float32Array(GENERATION_POINTS.count * 3);
  for (let index = 0; index < GENERATION_POINTS.count; index++) {
    const offset = Math.floor((index * 8000) / GENERATION_POINTS.count) * 24;
    for (let axis = 0; axis < 3; axis++) {
      const position = data.getFloat32(offset + axis * 4, true);
      const color = data.getFloat32(offset + 12 + axis * 4, true);
      if (
        !Number.isFinite(position) ||
        !Number.isFinite(color) ||
        color < 0 ||
        color > 1
      )
        throw new Error("Invalid surface point");
      positions[index * 3 + axis] = position;
      colors[index * 3 + axis] = color;
    }
  }
  return { positions, colors };
}
