import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { writeJson } from "../util/write-json.ts";
import { checkSurfaceTextures } from "./check-surface-textures.ts";

test("checks every texture map, repeat dimensions and image size", async () => {
  const folder = mkdtempSync(join(tmpdir(), "surface-gate-"));
  function result(repeatSizeM = { u: 0.5, v: 0.6 }) {
    writeJson({
      path: join(folder, "surface.json"),
      value: {
        color: "#ffffff",
        material: {
          kind: "texture",
          repeatSizeM,
          roughness: 0.7,
          textureAssetId: "agent-output",
        },
      },
    });
  }
  async function solid(options: { file: string; size?: number }) {
    await sharp({
      create: {
        width: options.size ?? 8,
        height: options.size ?? 8,
        channels: 4,
        background: "white",
      },
    })
      .png()
      .toFile(join(folder, options.file));
  }
  try {
    result();
    await solid({ file: "baseColor.png" });
    const checked = await checkSurfaceTextures({
      folder,
      assetId: "assigned-id",
    });
    expect(checked.material).toMatchObject({ textureAssetId: "assigned-id" });
    const pixels = Buffer.alloc(8 * 8 * 4, 255);
    pixels[0] = 0;
    await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } })
      .png()
      .toFile(join(folder, "normal.png"));
    await expect(
      checkSurfaceTextures({ folder, assetId: "assigned-id" }),
    ).rejects.toThrow("normal.png is not tileable");
    await solid({ file: "normal.png" });
    result({ u: 0.01, v: 0.5 });
    await expect(
      checkSurfaceTextures({ folder, assetId: "assigned-id" }),
    ).rejects.toThrow();
    result();
    await solid({ file: "baseColor.png", size: 2049 });
    await expect(
      checkSurfaceTextures({ folder, assetId: "assigned-id" }),
    ).rejects.toThrow();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("paint needs no texture files and uses its material colour", async () => {
  const folder = mkdtempSync(join(tmpdir(), "paint-gate-"));
  try {
    for (const finish of ["matte", "eggshell", "satin"]) {
      writeJson({
        path: join(folder, "surface.json"),
        value: {
          color: "#ffffff",
          material: { kind: "paint", color: "#9cae92", finish },
        },
      });
      expect(await checkSurfaceTextures({ folder, assetId: "unused" })).toEqual(
        {
          color: "#9cae92",
          material: { kind: "paint", color: "#9cae92", finish },
          files: [],
        },
      );
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
