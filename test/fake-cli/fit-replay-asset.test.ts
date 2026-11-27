import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildGlb } from "../../apps/web/src/capture/e2e/build-glb.ts";
import { fitReplayAsset } from "../../scripts/demo/fit-replay-asset.ts";

it("fits the copied model, appearance points and trace lines to the saved edited size once", () => {
  const folder = mkdtempSync(join(tmpdir(), "planner-fit-replay-"));
  try {
    const binary = Buffer.from([1, 2, 3, 4]);
    writeFileSync(
      join(folder, "model.glb"),
      buildGlb({
        json: {
          asset: { version: "2.0" },
          nodes: [{ translation: [0, 1, 0] }],
          scenes: [{ nodes: [0] }],
        },
        binary,
      }),
    );
    writeFileSync(
      join(folder, "meta.json"),
      JSON.stringify({
        id: "saved",
        kind: "generated",
        nativeSizeM: { width: 1, height: 2, depth: 4 },
        mount: "floor",
        triangleCount: 12,
        hasColorMask: false,
        provenance: { method: "saved", sourcePhotoIds: [] },
      }),
    );
    const points = Buffer.alloc(24);
    [1, 2, 4, 0.2, 0.4, 0.6].forEach((value, index) => {
      points.writeFloatLE(value, index * 4);
    });
    writeFileSync(join(folder, "points.bin"), points);
    const lines = Buffer.alloc(32);
    lines.writeUInt32LE(1, 0);
    lines.writeUInt32LE(2, 4);
    [1, 2, 4, 2, 4, 8].forEach((value, index) => {
      lines.writeFloatLE(value, 8 + index * 4);
    });
    writeFileSync(join(folder, "lines.bin"), lines);
    const sizeM = { width: 3, height: 4, depth: 2 };
    fitReplayAsset({ folder, sizeM });
    const model = readFileSync(join(folder, "model.glb"));
    const jsonEnd = 20 + model.readUInt32LE(12);
    expect(JSON.parse(model.subarray(20, jsonEnd).toString())).toMatchObject({
      nodes: [
        { translation: [0, 1, 0] },
        { scale: [3, 2, 0.5], children: [0] },
      ],
      scenes: [{ nodes: [1] }],
    });
    expect(model.subarray(jsonEnd + 8)).toEqual(binary);
    expect(model.readUInt32LE(8)).toBe(model.length);
    const fittedPoints = readFileSync(join(folder, "points.bin"));
    expect([0, 4, 8].map((offset) => fittedPoints.readFloatLE(offset))).toEqual(
      [3, 4, 2],
    );
    expect(fittedPoints.subarray(12)).toEqual(points.subarray(12));
    const fittedLines = readFileSync(join(folder, "lines.bin"));
    expect(
      [8, 12, 16, 20, 24, 28].map((offset) => fittedLines.readFloatLE(offset)),
    ).toEqual([3, 4, 2, 6, 8, 4]);
    expect(
      JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")).nativeSizeM,
    ).toEqual(sizeM);
    fitReplayAsset({ folder, sizeM });
    expect(readFileSync(join(folder, "model.glb"))).toEqual(model);
    expect(readFileSync(join(folder, "points.bin"))).toEqual(fittedPoints);
    expect(readFileSync(join(folder, "lines.bin"))).toEqual(fittedLines);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
