export function readTraceLines(buffer: ArrayBuffer) {
  const data = new DataView(buffer);
  if (buffer.byteLength < 4) throw new Error("Invalid trace lines");
  const count = data.getUint32(0, true);
  const positions: number[] = [];
  let offset = 4;
  for (let line = 0; line < count; line++) {
    if (offset + 4 > buffer.byteLength)
      throw new Error("Incomplete trace line");
    const vertices = data.getUint32(offset, true);
    offset += 4;
    if (vertices < 2 || offset + vertices * 12 > buffer.byteLength)
      throw new Error("Invalid trace vertices");
    for (let vertex = 0; vertex < vertices - 1; vertex++) {
      for (let coordinate = 0; coordinate < 6; coordinate++) {
        const value = data.getFloat32(
          offset + vertex * 12 + coordinate * 4,
          true,
        );
        if (!Number.isFinite(value)) throw new Error("Invalid trace position");
        positions.push(value);
      }
    }
    offset += vertices * 12;
  }
  if (offset !== buffer.byteLength) throw new Error("Unexpected trace bytes");
  return positions;
}
