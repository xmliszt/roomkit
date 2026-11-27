import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { z } from "zod";

export function fitReplayAsset(options: { folder: string; sizeM: Size }) {
  const metaPath = join(options.folder, "meta.json");
  const meta = AssetMetaSchema.parse(
    JSON.parse(readFileSync(metaPath, "utf8")),
  );
  const scale = [
    options.sizeM.width / meta.nativeSizeM.width,
    options.sizeM.height / meta.nativeSizeM.height,
    options.sizeM.depth / meta.nativeSizeM.depth,
  ];
  if (scale.every((value) => value === 1)) return;
  const modelPath = join(options.folder, "model.glb");
  const model = readFileSync(modelPath);
  assert.equal(model.readUInt32LE(0), 0x46546c67);
  assert.equal(model.readUInt32LE(4), 2);
  const jsonEnd = 20 + model.readUInt32LE(12);
  const json = z
    .object({
      nodes: z.array(z.unknown()),
      scenes: z.array(z.object({ nodes: z.array(z.number()) }).passthrough()),
    })
    .passthrough()
    .parse(JSON.parse(model.subarray(20, jsonEnd).toString()));
  for (const scene of json.scenes) {
    const root = json.nodes.length;
    json.nodes.push({ scale, children: scene.nodes });
    scene.nodes = [root];
  }
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([
    encoded,
    Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
  ]);
  const header = Buffer.from(model.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + model.length - jsonEnd, 8);
  header.writeUInt32LE(padded.length, 12);
  writeFileSync(
    modelPath,
    Buffer.concat([header, padded, model.subarray(jsonEnd)]),
  );
  function scalePosition(options: { data: Buffer; offset: number }) {
    scale.forEach((factor, axis) => {
      options.data.writeFloatLE(
        options.data.readFloatLE(options.offset + axis * 4) * factor,
        options.offset + axis * 4,
      );
    });
  }
  const pointsPath = join(options.folder, "points.bin");
  if (meta.kind !== "catalog" || existsSync(pointsPath)) {
    const points = readFileSync(pointsPath);
    for (let offset = 0; offset < points.length; offset += 24)
      scalePosition({ data: points, offset });
    writeFileSync(pointsPath, points);
  }
  const linesPath = join(options.folder, "lines.bin");
  if (meta.kind !== "catalog" || existsSync(linesPath)) {
    const lines = readFileSync(linesPath);
    let offset = 4;
    for (let line = 0; line < lines.readUInt32LE(0); line++) {
      const count = lines.readUInt32LE(offset);
      offset += 4;
      for (let vertex = 0; vertex < count; vertex++, offset += 12)
        scalePosition({ data: lines, offset });
    }
    assert.equal(offset, lines.length);
    writeFileSync(linesPath, lines);
  }
  writeFileSync(
    metaPath,
    JSON.stringify({ ...meta, nativeSizeM: options.sizeM }),
  );
}
