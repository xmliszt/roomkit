import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { PhotoBoxSchema } from "@planner/shared/src/photos/photo-box-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import sharp from "sharp";
import { z } from "zod";
import { jobFilePath } from "../generation/job-file-path.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { HttpError } from "./http-error.ts";
import { pruneCropCache } from "./prune-crop-cache.ts";

export async function readPhotoCrop(options: {
  folder: string;
  photoId: string;
  url: URL;
  response: ServerResponse;
}) {
  if (!IdSchema.safeParse(options.photoId).success)
    throw new HttpError({ status: 404, message: "Not found" });
  const query = z
    .object({
      box: z
        .string()
        .transform((value) =>
          value
            .split(",")
            .map((part) => (part.trim() === "" ? Number.NaN : Number(part))),
        )
        .pipe(PhotoBoxSchema),
      size: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(64).max(1024))
        .default(256),
    })
    .safeParse(Object.fromEntries(options.url.searchParams));
  if (!query.success)
    throw new HttpError({
      status: 400,
      message: "Send a box in 0–1 coordinates and size from 64 to 1024",
    });
  const photo = readPhotos(options.folder).find(
    (photo) => photo.photoId === options.photoId,
  );
  if (photo?.kind !== "accepted")
    throw new HttpError({ status: 404, message: "Not found" });
  const relativePath = join("photos", photo.uprightPath);
  if (!existsSync(join(options.folder, relativePath)))
    throw new HttpError({ status: 404, message: "Not found" });
  const path = (() => {
    try {
      return jobFilePath({ folder: options.folder, path: relativePath });
    } catch {
      throw new HttpError({ status: 404, message: "Not found" });
    }
  })();
  const stat = statSync(path);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        photoId: photo.photoId,
        ...query.data,
        box: query.data.box.map((value) => Math.round(value * 10000) / 10000),
        mtimeMs: stat.mtimeMs,
        bytes: stat.size,
      }),
    )
    .digest("hex");
  const plannerPath = jobFilePath({ folder: options.folder, path: ".planner" });
  if (!existsSync(join(plannerPath, "crops")))
    mkdirSync(join(plannerPath, "crops"));
  const cachePath = jobFilePath({
    folder: options.folder,
    path: join(".planner", "crops", `${hash}.jpg`),
  });
  if (!existsSync(cachePath)) {
    const metadata = await sharp(path).metadata();
    const widthPx = metadata.width;
    const heightPx = metadata.height;
    if (!widthPx || !heightPx)
      throw new HttpError({
        status: 415,
        message: "The source photo could not be decoded",
      });
    const [x0, y0, x1, y1] = query.data.box;
    const paddingX = (x1 - x0) * 0.08;
    const paddingY = (y1 - y0) * 0.08;
    const left = Math.max(0, Math.floor((x0 - paddingX) * widthPx));
    const top = Math.max(0, Math.floor((y0 - paddingY) * heightPx));
    const right = Math.min(widthPx, Math.ceil((x1 + paddingX) * widthPx));
    const bottom = Math.min(heightPx, Math.ceil((y1 + paddingY) * heightPx));
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await sharp(path)
        .extract({ left, top, width: right - left, height: bottom - top })
        .resize({
          width: query.data.size,
          height: query.data.size,
          fit: "inside",
        })
        .jpeg()
        .toFile(temporary);
      renameSync(temporary, cachePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  const cached = statSync(cachePath);
  utimesSync(cachePath, new Date(), cached.mtime);
  options.response.writeHead(200, {
    "content-type": "image/jpeg",
    "content-length": statSync(cachePath).size,
    "x-content-type-options": "nosniff",
  });
  try {
    await pipeline(createReadStream(cachePath), options.response);
  } finally {
    pruneCropCache({
      folder: jobFilePath({ folder: options.folder, path: ".planner/crops" }),
    });
  }
}
