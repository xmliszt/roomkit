/// <reference path="./gltf-validator.d.ts" />
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { SizeSchema } from "@planner/shared/src/scene/size-schema.ts";
import validator from "gltf-validator";
import sharp from "sharp";
import { z } from "zod";
import { floorCoveringMinHeightM } from "./floor-covering-min-height-m.ts";
import { isFloorCovering } from "./is-floor-covering.ts";

const NormalizedSchema = z.object({
  nativeSizeM: SizeSchema,
  triangleCount: z.number().int().positive().max(150000),
  hasColorMask: z.literal(true),
  referenceLuma: z.number().positive().max(1),
});
const GltfSchema = z.object({
  images: z
    .array(z.object({ bufferView: z.number().int().nonnegative() }))
    .min(1),
  bufferViews: z.array(
    z.object({
      buffer: z.literal(0),
      byteOffset: z.number().int().nonnegative().default(0),
      byteLength: z.number().int().positive(),
    }),
  ),
  buffers: z
    .array(
      z.object({
        byteLength: z.number().int().positive(),
        uri: z.never().optional(),
      }),
    )
    .length(1),
});

export async function checkGeneratedAsset(options: {
  folder: string;
  placementKind: Placement["kind"];
  expected: Size;
  normalized: unknown;
}) {
  const normalized = NormalizedSchema.parse(options.normalized);
  const path = join(options.folder, "model.glb");
  if (statSync(path).size > 25_000_000) throw new Error("GLB exceeds 25 MB");
  const bytes = readFileSync(path);
  const result = await validator.validateBytes(bytes, { uri: "model.glb" });
  if (result.issues.numErrors)
    throw new Error(`GLB validator found ${result.issues.numErrors} errors`);
  if (
    isFloorCovering({
      placementKind: options.placementKind,
      sizeM: options.expected,
    }) &&
    normalized.nativeSizeM.height < floorCoveringMinHeightM
  )
    throw new Error(
      `Floor covering too thin: height is ${normalized.nativeSizeM.height} m; expected at least ${floorCoveringMinHeightM} m`,
    );
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = GltfSchema.parse(
    JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")),
  );
  const binary = bytes.subarray(28 + jsonLength);
  for (const image of gltf.images) {
    const view = gltf.bufferViews.at(image.bufferView);
    if (!view) throw new Error("Texture buffer view is missing");
    const metadata = await sharp(
      binary.subarray(view.byteOffset, view.byteOffset + view.byteLength),
    ).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 2048 ||
      metadata.height > 2048
    )
      throw new Error("Texture exceeds 2048 px");
  }
  if (statSync(join(options.folder, "points.bin")).size !== 8000 * 24)
    throw new Error("Surface points are incomplete");
  for (const sidecar of ["lines.bin", "thumb.png", "colorMask.png"])
    if (!statSync(join(options.folder, sidecar)).size)
      throw new Error(`Missing ${sidecar}`);
  return normalized;
}
