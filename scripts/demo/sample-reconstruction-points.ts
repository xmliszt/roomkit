import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PhotosSchema } from "@planner/shared/src/photos/photo-schema.ts";

const POINT_COUNT = 8000;
const UINT32_MAX = 0xffffffff;

type NpyArray = { descr: string; shape: number[]; data: ArrayBuffer };

function readNpz(path: string) {
  const zip = readFileSync(path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, `Not a zip file: ${path}`);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const arrays: { [name: string]: NpyArray } = {};
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, "Bad zip entry");
    const method = zip.readUInt16LE(offset + 10);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString("latin1", offset + 46, offset + 46 + nameLength);
    const fields = [
      zip.readUInt32LE(offset + 24),
      zip.readUInt32LE(offset + 20),
      zip.readUInt32LE(offset + 42),
    ];
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra < extraEnd) {
      const id = zip.readUInt16LE(extra);
      const size = zip.readUInt16LE(extra + 2);
      if (id === 1) {
        let cursor = extra + 4;
        for (const [field, value] of fields.entries())
          if (value === UINT32_MAX) {
            fields[field] = Number(zip.readBigUInt64LE(cursor));
            cursor += 8;
          }
      }
      extra += 4 + size;
    }
    const [, compressedSize = 0, localOffset = 0] = fields;
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    assert.ok(method === 0 || method === 8, `Unsupported zip method ${method}`);
    const npy = method === 8 ? inflateRawSync(raw) : raw;
    const major = npy.readUInt8(6);
    const headerLength =
      major === 1 ? npy.readUInt16LE(8) : npy.readUInt32LE(8);
    const headerStart = major === 1 ? 10 : 12;
    const header = npy.toString(
      "latin1",
      headerStart,
      headerStart + headerLength,
    );
    assert.match(
      header,
      /'fortran_order':\s*False/,
      `${name} is Fortran order`,
    );
    arrays[name.replace(/\.npy$/, "")] = {
      descr: /'descr':\s*'([^']+)'/.exec(header)?.at(1) ?? "",
      shape: (/'shape':\s*\(([^)]*)\)/.exec(header)?.at(1) ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map(Number),
      data: new Uint8Array(npy.subarray(headerStart + headerLength)).buffer,
    };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return arrays;
}

function requireArray(options: {
  arrays: { [name: string]: NpyArray };
  name: string;
  descr: string;
}) {
  const array = options.arrays[options.name];
  assert.equal(array?.descr, options.descr, `${options.name} dtype`);
  return array;
}

function roundHalfEven(value: number) {
  const floor = Math.floor(value);
  const difference = value - floor;
  if (difference !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Write `outputPath` with 8000 coloured points sampled from the reconstruction at `scenePath` and the accepted photos in `photosPath`, in the `points.bin` layout (x, y, z, r, g, b as little-endian float32); return `false` without writing when no point is valid.
 */
export async function sampleReconstructionPoints(options: {
  scenePath: string;
  photosPath: string;
  outputPath: string;
}) {
  const sharp: typeof import("../../packages/daemon/node_modules/sharp/dist/index.mjs").default =
    createRequire(
      join(import.meta.dirname, "../../packages/daemon/package.json"),
    )("sharp");
  const arrays = readNpz(options.scenePath);
  const namesArray = arrays.names;
  assert.ok(namesArray && /^<U\d+$/.test(namesArray.descr), "names dtype");
  const nameLength = Number(namesArray.descr.slice(2));
  const names = Array.from({ length: namesArray.shape.at(0) ?? 0 }, (_, i) =>
    String.fromCodePoint(
      ...Array.from({ length: nameLength }, (_, c) =>
        new DataView(namesArray.data).getUint32((i * nameLength + c) * 4, true),
      ).filter((code) => code !== 0),
    ),
  );
  const pointsArray = requireArray({
    arrays,
    name: "world_points",
    descr: "<f4",
  });
  const points = new Float32Array(pointsArray.data);
  const masks = new Uint8Array(
    requireArray({ arrays, name: "masks", descr: "|b1" }).data,
  );
  const transforms = new Float64Array(
    requireArray({ arrays, name: "transforms", descr: "<f8" }).data,
  );
  const imageSizes = new BigInt64Array(
    requireArray({ arrays, name: "image_sizes", descr: "<i8" }).data,
  );
  const height = pointsArray.shape.at(1) ?? 0;
  const width = pointsArray.shape.at(2) ?? 0;
  const photosFolder = dirname(options.photosPath);
  const photos = PhotosSchema.parse(
    JSON.parse(readFileSync(options.photosPath, "utf8")),
  ).photos;
  const views = names.flatMap((name, index) => {
    const photo = photos.find((photo) => photo.photoId === name);
    if (photo?.kind !== "accepted") return [];
    const scale = transforms[index * 3] ?? Number.NaN;
    const left = transforms[index * 3 + 1] ?? Number.NaN;
    const top = transforms[index * 3 + 2] ?? Number.NaN;
    const sourceWidth = Number(imageSizes[index * 2]);
    const sourceHeight = Number(imageSizes[index * 2 + 1]);
    if (
      ![scale, left, top, sourceWidth, sourceHeight].every(Number.isFinite) ||
      scale <= 0 ||
      Math.min(sourceWidth, sourceHeight) <= 0
    )
      throw new Error("Reconstruction has an invalid photo transform");
    return [
      {
        index,
        path: join(photosFolder, photo.visionPath),
        scale,
        left,
        top,
        sourceWidth,
        sourceHeight,
      },
    ];
  });
  type PhotoView = (typeof views)[number];
  function validPixels(input: {
    view: PhotoView;
    colorWidth: number;
    colorHeight: number;
  }) {
    const pixels: { pointOffset: number; colorOffset: number }[] = [];
    const v = input.view;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const cell = (v.index * height + y) * width + x;
        if (masks[cell] === 0) continue;
        const pointOffset = cell * 3;
        if (
          ![0, 1, 2].every((axis) =>
            Number.isFinite(points[pointOffset + axis]),
          )
        )
          continue;
        const photoX = roundHalfEven(
          (((x + v.left) / v.scale) * input.colorWidth) / v.sourceWidth,
        );
        const photoY = roundHalfEven(
          (((y + v.top) / v.scale) * input.colorHeight) / v.sourceHeight,
        );
        if (
          photoX < 0 ||
          photoX >= input.colorWidth ||
          photoY < 0 ||
          photoY >= input.colorHeight
        )
          continue;
        pixels.push({
          pointOffset,
          colorOffset: photoY * input.colorWidth + photoX,
        });
      }
    return pixels;
  }
  const counts = await Promise.all(
    views.map(async (view) => {
      const metadata = await sharp(view.path).metadata();
      return validPixels({
        view,
        colorWidth: metadata.width,
        colorHeight: metadata.height,
      }).length;
    }),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return false;
  const selected = Array.from({ length: POINT_COUNT }, (_, k) =>
    Math.floor((k * total) / POINT_COUNT),
  );
  const output = new Float32Array(POINT_COUNT * 6);
  let next = 0;
  let start = 0;
  for (const [position, view] of views.entries()) {
    const count = counts.at(position) ?? 0;
    const end = start + count;
    if ((selected.at(next) ?? end) < end) {
      const { data, info } = await sharp(view.path)
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = validPixels({
        view,
        colorWidth: info.width,
        colorHeight: info.height,
      });
      while (next < POINT_COUNT && (selected.at(next) ?? end) < end) {
        const pixel = pixels.at((selected.at(next) ?? 0) - start);
        assert.ok(pixel);
        const row = next * 6;
        for (const axis of [0, 1, 2]) {
          output[row + axis] = points[pixel.pointOffset + axis] ?? 0;
          output[row + 3 + axis] =
            (data[pixel.colorOffset * info.channels + axis] ?? 0) / 255;
        }
        next += 1;
      }
    }
    start = end;
  }
  const temporary = join(
    dirname(options.outputPath),
    `.points-${randomUUID()}`,
  );
  try {
    writeFileSync(temporary, Buffer.from(output.buffer));
    renameSync(temporary, options.outputPath);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}
