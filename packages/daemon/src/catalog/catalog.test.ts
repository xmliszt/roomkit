import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { listCatalogAssetIds } from "./list-catalog-asset-ids.ts";

const catalogRoot = fileURLToPath(new URL("../../catalog", import.meta.url));

const GltfSchema = z.object({
  accessors: z.array(
    z.object({
      count: z.number(),
      min: z.array(z.number()).optional(),
      max: z.array(z.number()).optional(),
    }),
  ),
  meshes: z.array(
    z.object({
      primitives: z.array(
        z.object({
          attributes: z.object({ POSITION: z.number() }),
          indices: z.number(),
        }),
      ),
    }),
  ),
  nodes: z.array(
    z.object({
      translation: z.array(z.number()).optional(),
      rotation: z.array(z.number()).optional(),
      scale: z.array(z.number()).optional(),
    }),
  ),
});

function readGltf(path: string) {
  const glb = readFileSync(path);
  expect(glb.toString("ascii", 0, 4)).toBe("glTF");
  const length = glb.readUInt32LE(12);
  expect(glb.toString("ascii", 16, 20)).toBe("JSON");
  return GltfSchema.parse(JSON.parse(glb.toString("utf8", 20, 20 + length)));
}

test("the catalog holds one folder per charging port type", () => {
  expect(listCatalogAssetIds(catalogRoot)).toStrictEqual(
    new Set(CHARGING_PORT_TYPES.map((entry) => entry.assetId)),
  );
});

describe.each(CHARGING_PORT_TYPES)("$typeId", (entry) => {
  const folder = `${catalogRoot}/${entry.assetId}`;

  test("meta.json passes the schema and matches the shared entry", () => {
    const meta = AssetMetaSchema.parse(
      JSON.parse(readFileSync(`${folder}/meta.json`, "utf8")),
    );
    expect(meta).toMatchObject({
      id: entry.assetId,
      kind: "catalog",
      mount: entry.mount,
      nativeSizeM: entry.sizeM,
    });
    const gltf = readGltf(`${folder}/model.glb`);
    const triangles = gltf.meshes
      .flatMap((mesh) => mesh.primitives)
      .reduce(
        (sum, primitive) =>
          sum + (gltf.accessors.at(primitive.indices)?.count ?? 0) / 3,
        0,
      );
    expect(meta.triangleCount).toBe(triangles);
  });

  test("the GLB has its back face centred on the origin and +Z in front", () => {
    const gltf = readGltf(`${folder}/model.glb`);
    for (const node of gltf.nodes) {
      expect(node.rotation ?? [0, 0, 0, 1]).toStrictEqual([0, 0, 0, 1]);
      expect(node.scale ?? [1, 1, 1]).toStrictEqual([1, 1, 1]);
      expect(node.translation ?? [0, 0, 0]).toStrictEqual([0, 0, 0]);
    }
    const positions = gltf.meshes
      .flatMap((mesh) => mesh.primitives)
      .map((primitive) => gltf.accessors.at(primitive.attributes.POSITION));
    const min = [0, 1, 2].map((axis) =>
      Math.min(...positions.map((accessor) => accessor?.min?.[axis] ?? 0)),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...positions.map((accessor) => accessor?.max?.[axis] ?? 0)),
    );
    for (const [value, expected] of [
      [min[0], -entry.sizeM.width / 2],
      [max[0], entry.sizeM.width / 2],
      [min[1], -entry.sizeM.height / 2],
      [max[1], entry.sizeM.height / 2],
      [min[2], 0],
      [max[2], entry.sizeM.depth],
    ])
      expect(value).toBeCloseTo(expected ?? Number.NaN, 6);
  });
});
