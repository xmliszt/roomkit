import { generationFixture } from "../../../e2e/generation-fixture.ts";
import { buildGlb } from "./build-glb.ts";

export function mirrorMaskFixture(
  options: { transformed?: boolean; repeated?: boolean } = {},
) {
  const fixture = generationFixture();
  const jsonLength = fixture.glb.readUInt32LE(12);
  const original = JSON.parse(
    fixture.glb.subarray(20, 20 + jsonLength).toString(),
  );
  const originalBinary = fixture.glb.subarray(28 + jsonLength);
  const count = original.accessors[0].count;
  const uvs = Buffer.alloc(count * 8);
  for (let index = 0; index < count; index++) {
    uvs.writeFloatLE(originalBinary.readFloatLE(index * 12) + 0.5, index * 8);
    uvs.writeFloatLE(originalBinary.readFloatLE(index * 12 + 4), index * 8 + 4);
  }
  const reversedUvs = Buffer.from(uvs);
  for (let index = 0; index < count; index++) {
    reversedUvs.writeFloatLE(1 - uvs.readFloatLE(index * 8), index * 8);
  }
  const binary = Buffer.concat([originalBinary, reversedUvs, uvs]);
  const json = {
    ...original,
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              TEXCOORD_0: 2,
              TEXCOORD_1: 3,
            },
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.6, 0.6, 0.6, 1],
          baseColorTexture: {
            index: 0,
            texCoord: 1,
            ...(options.transformed || options.repeated
              ? {
                  extensions: {
                    KHR_texture_transform: {
                      offset: [1, 0],
                      scale: [options.repeated ? 1 : -1, 1],
                    },
                  },
                }
              : {}),
          },
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    images: [
      {
        uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
      },
    ],
    textures: [{ source: 0 }],
    ...(options.transformed || options.repeated
      ? { extensionsUsed: ["KHR_texture_transform"] }
      : {}),
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      ...original.bufferViews,
      {
        buffer: 0,
        byteOffset: originalBinary.length,
        byteLength: reversedUvs.length,
      },
      {
        buffer: 0,
        byteOffset: originalBinary.length + reversedUvs.length,
        byteLength: uvs.length,
      },
    ],
    accessors: [
      ...original.accessors,
      { bufferView: 2, componentType: 5126, count, type: "VEC2" },
      { bufferView: 3, componentType: 5126, count, type: "VEC2" },
    ],
  };
  return {
    glb: buildGlb({ json, binary }),
    mask: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAABCAIAAABsYngUAAAADklEQVR4nGP4jwQYkAAA3TsL9WxSRxoAAAAASUVORK5CYII=",
      "base64",
    ),
  };
}
