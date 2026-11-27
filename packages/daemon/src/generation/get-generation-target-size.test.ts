import { expect, test } from "vitest";
import { GenerationRecordSchema } from "./generation-record-schema.ts";
import { getGenerationTargetSize } from "./get-generation-target-size.ts";

function record(options: { depth: number; cutsOpening?: boolean }) {
  const now = new Date().toISOString();
  return GenerationRecordSchema.parse({
    job: {
      id: "job",
      kind: "generation",
      projectId: crypto.randomUUID(),
      itemId: "door",
      stage: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    },
    item: {
      id: "door",
      name: "Door",
      locked: false,
      ...(options.cutsOpening === undefined
        ? {}
        : { cutsOpening: options.cutsOpening }),
      model: { kind: "pending", jobId: "job" },
      placement: {
        kind: "wall",
        wallId: "wall",
        alongM: 2,
        heightM: 1,
        rotationRad: 0,
      },
      sizeM: { width: 2.34, height: 2.33, depth: options.depth },
    },
    source: { kind: "photo", photoId: "photo" },
    prompt: "Door",
    held: false,
    attempt: 0,
    assetId: "asset",
  });
}

for (const depth of [0.85, 0.27, 0.12, 0.04]) {
  test(`opening target caps ${depth} without changing stored dimensions`, () => {
    const input = record({ depth, cutsOpening: true });
    expect(getGenerationTargetSize(input)).toEqual({
      width: 2.34,
      height: 2.33,
      depth: Math.min(depth, 0.25),
    });
    expect(input.item.sizeM.depth).toBe(depth);
  });
}
for (const cutsOpening of [undefined, false]) {
  test(`ordinary item with flag ${cutsOpening} keeps the requested depth`, () => {
    const input = record({
      depth: 0.85,
      ...(cutsOpening === undefined ? {} : { cutsOpening }),
    });
    expect(getGenerationTargetSize(input)).toEqual(input.item.sizeM);
  });
}
test("recolour keeps the parent asset proportions", () => {
  const input = record({ depth: 0.85, cutsOpening: true });
  input.source = {
    kind: "color",
    parentAssetId: "parent",
    color: "#ffffff",
    strength: 0.5,
    referenceLuma: 0.5,
    nativeSizeM: { width: 2.34, height: 2.33, depth: 0.2 },
  };
  expect(getGenerationTargetSize(input)).toEqual(input.source.nativeSizeM);
});
