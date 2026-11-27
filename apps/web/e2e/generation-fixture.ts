import { BoxGeometry, type BufferGeometry, EdgesGeometry } from "three";

export function generationFixture(
  options: {
    textureDataUrl?: string;
    color?: [number, number, number];
    geometry?: BufferGeometry;
  } = {},
) {
  const geometry =
    options.geometry ??
    new BoxGeometry(1, 1, 1).toNonIndexed().translate(0, 0.5, 0);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const vertices = Buffer.from(new Float32Array(position.array).buffer);
  const normals = Buffer.from(new Float32Array(normal.array).buffer);
  const uvs = Buffer.from(new Float32Array(uv.array).buffer);
  const binary = Buffer.concat([vertices, normals, uvs]);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
              material: 0,
            },
          ],
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            ...(options.textureDataUrl
              ? { baseColorTexture: { index: 0 } }
              : {}),
            baseColorFactor: [...(options.color ?? [0.8, 0.15, 0.03]), 1],
            metallicFactor: 0,
            roughnessFactor: 0.8,
          },
        },
      ],
      ...(options.textureDataUrl
        ? {
            images: [{ uri: options.textureDataUrl }],
            textures: [{ source: 0 }],
          }
        : {}),
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: vertices.length },
        { buffer: 0, byteOffset: vertices.length, byteLength: normals.length },
        {
          buffer: 0,
          byteOffset: vertices.length + normals.length,
          byteLength: uvs.length,
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: position.count,
          type: "VEC3",
          min: [-0.5, 0, -0.5],
          max: [0.5, 1, 0.5],
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: normal.count,
          type: "VEC3",
        },
        { bufferView: 2, componentType: 5126, count: uv.count, type: "VEC2" },
      ],
    }),
  );
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  const points = Buffer.alloc(8000 * 24);
  for (let index = 0; index < 8000; index++) {
    const face = index % 6;
    const a = Math.sin(index * 127.1 + 311.7) * 43758.5453;
    const b = Math.sin(index * 79.3 + 193.1) * 32719.437;
    const u = a - Math.floor(a) - 0.5;
    const v = b - Math.floor(b) - 0.5;
    const xyz =
      face < 2
        ? [face - 0.5, u + 0.5, v]
        : face < 4
          ? [u, face - 2, v]
          : [u, v + 0.5, face - 4.5];
    [...xyz, ...(options.color ?? [0.8, 0.15, 0.03])].forEach(
      (value, coordinate) => {
        points.writeFloatLE(value, index * 24 + coordinate * 4);
      },
    );
  }
  const edgeGeometry = new EdgesGeometry(geometry);
  const edges = edgeGeometry.getAttribute("position");
  const lines = Buffer.alloc(4 + (edges.count / 2) * 28);
  lines.writeUInt32LE(edges.count / 2, 0);
  for (let index = 0; index < edges.count / 2; index++) {
    lines.writeUInt32LE(2, 4 + index * 28);
    for (let vertex = 0; vertex < 2; vertex++) {
      const at = index * 2 + vertex;
      [edges.getX(at), edges.getY(at), edges.getZ(at)].forEach(
        (value, axis) => {
          lines.writeFloatLE(value, 8 + index * 28 + vertex * 12 + axis * 4);
        },
      );
    }
  }
  geometry.dispose();
  edgeGeometry.dispose();
  return {
    glb: Buffer.concat([header, padded, binaryHeader, binary]),
    points,
    lines,
  };
}
