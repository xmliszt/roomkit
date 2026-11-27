import { generationFixture } from "../../../e2e/generation-fixture.ts";
import { buildGlb } from "./build-glb.ts";

export function mirrorFixture(options: { isWall: boolean }) {
  const fixture = generationFixture();
  const jsonLength = fixture.glb.readUInt32LE(12);
  const original = JSON.parse(
    fixture.glb.subarray(20, 20 + jsonLength).toString(),
  );
  const binary = fixture.glb.subarray(28 + jsonLength);
  const yM = options.isWall ? -0.5 : 0;
  const zM = options.isWall ? 0.2 : 0;
  const json = {
    ...original,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, translation: [-0.3, yM, zM], scale: [0.4, 1, 0.4] },
      { mesh: 1, translation: [0.2, yM, zM], scale: [0.6, 0.5, 0.4] },
    ],
    meshes: [
      original.meshes[0],
      { primitives: [{ ...original.meshes[0].primitives[0], material: 1 }] },
    ],
    materials: [
      original.materials[0],
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
  };
  for (let offset = 0; offset < fixture.points.length; offset += 24) {
    fixture.points.writeFloatLE(
      fixture.points.readFloatLE(offset) * 0.4 - 0.3,
      offset,
    );
    fixture.points.writeFloatLE(
      fixture.points.readFloatLE(offset + 4) + yM,
      offset + 4,
    );
    fixture.points.writeFloatLE(
      fixture.points.readFloatLE(offset + 8) * 0.4 + zM,
      offset + 8,
    );
  }
  for (let offset = 8; offset < fixture.lines.length; offset += 28) {
    for (const vertex of [0, 12]) {
      const at = offset + vertex;
      fixture.lines.writeFloatLE(fixture.lines.readFloatLE(at) * 0.4 - 0.3, at);
      fixture.lines.writeFloatLE(
        fixture.lines.readFloatLE(at + 4) + yM,
        at + 4,
      );
      fixture.lines.writeFloatLE(
        fixture.lines.readFloatLE(at + 8) * 0.4 + zM,
        at + 8,
      );
    }
  }
  return {
    ...fixture,
    glb: buildGlb({ json, binary }),
  };
}
