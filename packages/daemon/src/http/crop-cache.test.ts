import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import sharp from "sharp";
import { expect, test } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { pruneCropCache } from "./prune-crop-cache.ts";

function cacheFile(options: {
  folder: string;
  name: string;
  bytes?: number;
  accessedAt?: number;
}) {
  const path = join(
    options.folder,
    `${createHash("sha256").update(options.name).digest("hex")}.jpg`,
  );
  writeFileSync(path, "x");
  if (options.bytes) truncateSync(path, options.bytes);
  const stamp = new Date(options.accessedAt ?? 1000);
  utimesSync(path, stamp, stamp);
  return path;
}

test("crop LRU evicts the least recently used files above 2000 entries", () => {
  const folder = mkdtempSync(join(tmpdir(), "planner-crop-count-"));
  try {
    const oldest = cacheFile({ folder, name: "oldest", accessedAt: 1 });
    for (const index of Array.from({ length: 2000 }, (_, index) => index))
      cacheFile({ folder, name: String(index), accessedAt: 1000 + index });
    const remaining = pruneCropCache({ folder });
    expect(remaining.count).toBe(2000);
    expect(readdirSync(folder)).toHaveLength(2000);
    expect(existsSync(oldest)).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("crop LRU also enforces the 200 MB limit using access time", () => {
  const folder = mkdtempSync(join(tmpdir(), "planner-crop-bytes-"));
  try {
    const oldest = cacheFile({
      folder,
      name: "oldest",
      bytes: 110 * 1024 ** 2,
      accessedAt: 1000,
    });
    const recent = cacheFile({
      folder,
      name: "recent",
      bytes: 100 * 1024 ** 2,
      accessedAt: 2000,
    });
    expect(pruneCropCache({ folder })).toEqual({
      count: 1,
      bytes: 100 * 1024 ** 2,
    });
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("crop requests ignore unknown query keys, quantize cache boxes and refresh LRU access", async () => {
  const fixture = await createTestFixture();
  try {
    const project = fixture.daemon.store.createProject({
      name: "Cache",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 3 },
    });
    const folder = fixture.daemon.store.projectPath(project.id);
    const origin = { origin: TEST_WEB_ORIGIN };
    const base = `http://127.0.0.1:${fixture.address.port}/projects/${project.id}`;
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const upload = await fetch(
      `${base}/photos?fileName=photo.png&origin=capture`,
      { method: "POST", headers: origin, body: image },
    );
    const photoId = PhotoUploadResultSchema.parse(await upload.json()).photoId;
    const first = await fetch(
      `${base}/photos/${photoId}/crop?box=0.1,0.1,0.9,0.9&size=256&unused=ignored`,
      { headers: origin },
    );
    expect(first.status).toBe(200);
    const bytes = Buffer.from(await first.arrayBuffer());
    const cache = join(folder, ".planner", "crops");
    const photo = readPhotos(folder).find((photo) => photo.photoId === photoId);
    if (photo?.kind !== "accepted") throw new Error("Missing uploaded photo");
    const stat = statSync(join(folder, "photos", photo.uprightPath));
    const expectedName = `${createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          photoId,
          box: [0.1, 0.1, 0.9, 0.9],
          size: 256,
          mtimeMs: stat.mtimeMs,
          bytes: stat.size,
        }),
      )
      .digest("hex")}.jpg`;
    expect(readdirSync(cache)).toEqual([expectedName]);
    const path = join(cache, expectedName);
    utimesSync(path, new Date(1000), new Date(1000));
    const second = await fetch(
      `${base}/photos/${photoId}/crop?box=0.100001,0.100002,0.900001,0.900002`,
      { headers: origin },
    );
    expect(second.status).toBe(200);
    expect(Buffer.from(await second.arrayBuffer())).toEqual(bytes);
    expect(readdirSync(cache)).toEqual([expectedName]);
    expect(statSync(path).mtimeMs).toBe(1000);
    expect(statSync(path).atimeMs).toBeGreaterThan(1000);
    mkdirSync(join(cache, "ignored-subdirectory"));
  } finally {
    await fixture.close();
  }
});
