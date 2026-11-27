import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import sharp from "sharp";
import { PhotoDecodeError } from "./photo-decode-error.ts";

const run = promisify(execFile);

export async function createPhotoCopies(options: {
  sourcePath: string;
  folder: string;
  photoId: string;
  heic: boolean;
}) {
  const converted = `${options.sourcePath}.jpg`;
  try {
    if (options.heic)
      await run(
        "/usr/bin/sips",
        ["-s", "format", "jpeg", options.sourcePath, "--out", converted],
        { timeout: 30_000 },
      ).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "stderr" in error &&
          typeof error.stderr === "string" &&
          error.stderr.includes("Cannot extract image from file")
        )
          throw new PhotoDecodeError("The photo could not be decoded", {
            cause: error,
          });
        throw error;
      });
    const source = options.heic ? converted : options.sourcePath;
    const bytes = await readFile(source);
    const decoded = await (async () => {
      try {
        const metadata = await sharp(bytes).metadata();
        const upright = await sharp(bytes)
          .autoOrient()
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 92 })
          .toBuffer({ resolveWithObject: true });
        return { metadata, upright };
      } catch (error) {
        throw new PhotoDecodeError("The photo could not be decoded", {
          cause: error,
        });
      }
    })();
    for (const folder of ["upright", "vision", "thumb"])
      await mkdir(join(options.folder, folder)).catch((error: unknown) => {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
      });
    const uprightPath = `upright/${options.photoId}.jpg`;
    const visionPath = `vision/${options.photoId}.jpg`;
    await writeFile(join(options.folder, uprightPath), decoded.upright.data);
    const vision = await sharp(join(options.folder, uprightPath))
      .resize({
        width: 1568,
        height: 1568,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 92 })
      .toFile(join(options.folder, visionPath));
    await sharp(join(options.folder, visionPath))
      .resize({
        width: 240,
        height: 240,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toFile(join(options.folder, "thumb", `${options.photoId}.jpg`));
    const { data, info } = await sharp(join(options.folder, visionPath))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const samples = [];
    for (let y = 1; y < info.height - 1; y++) {
      for (let x = 1; x < info.width - 1; x++) {
        const i = y * info.width + x;
        samples.push(
          (data[i - 1] ?? 0) +
            (data[i + 1] ?? 0) +
            (data[i - info.width] ?? 0) +
            (data[i + info.width] ?? 0) -
            4 * (data[i] ?? 0),
        );
      }
    }
    const mean =
      samples.reduce((sum, value) => sum + value, 0) /
      Math.max(1, samples.length);
    const blurScore =
      samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, samples.length);
    return {
      kind: "accepted",
      widthPx: decoded.upright.info.width,
      heightPx: decoded.upright.info.height,
      orientation: decoded.metadata.orientation ?? 1,
      blurScore,
      uprightPath,
      visionPath,
      visionWidthPx: vision.width,
      visionHeightPx: vision.height,
    } satisfies Omit<
      Extract<Photo, { kind: "accepted" }>,
      "photoId" | "origin" | "sourceFileName"
    >;
  } finally {
    await rm(converted, { force: true });
  }
}
