import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { expect, test } from "vitest";
import { checkGeneratedAsset } from "./check-generated-asset.ts";

async function checkRug(options: {
  placementKind?: Placement["kind"];
  expected: Size;
  native: Size;
}) {
  const folder = mkdtempSync(join(tmpdir(), "planner-rug-gate-"));
  try {
    copyFileSync(
      join(import.meta.dirname, "../../../../blender/fixtures/duck.glb"),
      join(folder, "model.glb"),
    );
    writeFileSync(join(folder, "points.bin"), Buffer.alloc(8000 * 24));
    for (const name of ["lines.bin", "thumb.png", "colorMask.png"])
      writeFileSync(join(folder, name), "fixture");
    return await checkGeneratedAsset({
      folder,
      placementKind: options.placementKind ?? "floor",
      expected: options.expected,
      normalized: {
        nativeSizeM: options.native,
        triangleCount: 12,
        hasColorMask: true,
        referenceLuma: 0.5,
      },
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("a model whose proportions differ from the estimate still passes", async () => {
  const native = { width: 1, height: 0.21659055352210999, depth: 0.9998 };
  await expect(
    checkRug({
      expected: { width: 1, height: 0.6666666501098216, depth: 0.9166666501 },
      native,
    }),
  ).resolves.toMatchObject({ nativeSizeM: native });
});

test.each([
  { placementKind: "floor", height: 0.002, passes: false },
  { placementKind: "floor", height: 0.003, passes: true },
  { placementKind: "wall", height: 0.002, passes: true },
] satisfies {
  placementKind: Placement["kind"];
  height: number;
  passes: boolean;
}[])(
  "5 mm $placementKind item measured at $height m passes: $passes",
  async (options) => {
    const native = { width: 2, height: options.height, depth: 1.4 };
    const result = checkRug({
      placementKind: options.placementKind,
      expected: { width: 2, height: 0.005, depth: 1.4 },
      native,
    });
    if (options.passes)
      await expect(result).resolves.toMatchObject({ nativeSizeM: native });
    else await expect(result).rejects.toThrow("Floor covering too thin");
  },
);
