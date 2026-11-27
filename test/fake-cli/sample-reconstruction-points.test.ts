import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import { sampleReconstructionPoints } from "../../scripts/demo/sample-reconstruction-points.ts";

const fixture = new URL("./fixtures/reconstruction-preview/", import.meta.url)
  .pathname;

it("samples the same points as python/workers/reconstruction_preview.py", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-points-"));
  try {
    const outputPath = join(root, "points.bin");
    expect(
      await sampleReconstructionPoints({
        scenePath: join(fixture, "scene.npz"),
        photosPath: join(fixture, "photos.json"),
        outputPath,
      }),
    ).toBe(true);
    expect(readFileSync(outputPath)).toEqual(
      readFileSync(join(fixture, "points.bin")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("writes nothing when no photo in the scene is accepted", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-points-"));
  try {
    const photosPath = join(root, "photos.json");
    writeJson({ path: photosPath, value: { version: 1, photos: [] } });
    const outputPath = join(root, "points.bin");
    expect(
      await sampleReconstructionPoints({
        scenePath: join(fixture, "scene.npz"),
        photosPath,
        outputPath,
      }),
    ).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
