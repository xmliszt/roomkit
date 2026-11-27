import { existsSync, readFileSync, statSync } from "node:fs";
import { ColorSchema } from "@planner/shared/src/scene/color-schema.ts";
import { SurfaceMaterialSchema } from "@planner/shared/src/scene/surface-material-schema.ts";
import sharp from "sharp";
import { z } from "zod";
import { jobFilePath } from "../generation/job-file-path.ts";

const ResultSchema = z
  .object({ color: ColorSchema, material: SurfaceMaterialSchema })
  .strict();

export async function checkSurfaceTextures(options: {
  folder: string;
  assetId: string;
}) {
  const result = ResultSchema.parse(
    JSON.parse(
      readFileSync(
        jobFilePath({ folder: options.folder, path: "surface.json" }),
        "utf8",
      ),
    ),
  );
  if (result.material.kind === "paint")
    return {
      color: result.material.color,
      material: result.material,
      files: [],
    };
  const material = { ...result.material, textureAssetId: options.assetId };
  const files = ["baseColor.png", "normal.png", "roughness.png"].filter(
    (name) =>
      name === "baseColor.png" ||
      existsSync(jobFilePath({ folder: options.folder, path: name })),
  );
  for (const name of files) {
    const path = jobFilePath({ folder: options.folder, path: name });
    if (statSync(path).size > 25_000_000)
      throw new Error(`${name} exceeds 25 MB`);
    const metadata = await sharp(path, {
      limitInputPixels: 2048 * 2048,
    }).metadata();
    if (
      metadata.format !== "png" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width < 2 ||
      metadata.height < 2 ||
      metadata.width > 2048 ||
      metadata.height > 2048
    )
      throw new Error(`${name} must be a PNG between 2 and 2048 px per side`);
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    function matches(options: { a: number; b: number }) {
      const { a, b } = options;
      for (let channel = 0; channel < info.channels; channel++)
        if (Math.abs((data[a + channel] ?? 0) - (data[b + channel] ?? 0)) > 2)
          throw new Error(
            `${name} is not tileable: opposite edges differ by more than 2/255`,
          );
    }
    for (let x = 0; x < info.width; x++)
      matches({
        a: x * info.channels,
        b: ((info.height - 1) * info.width + x) * info.channels,
      });
    for (let y = 0; y < info.height; y++)
      matches({
        a: y * info.width * info.channels,
        b: (y * info.width + info.width - 1) * info.channels,
      });
  }
  return { color: result.color, material, files };
}
