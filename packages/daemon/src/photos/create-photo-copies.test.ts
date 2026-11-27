import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { createPhotoCopies } from "./create-photo-copies.ts";

test("limits upright vision and thumbnail sizes without enlarging or retaining orientation", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-photo-copies-"));
  try {
    const sourcePath = join(root, "source.jpg");
    await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#aabbcc" },
    })
      .withMetadata({ orientation: 8 })
      .jpeg()
      .toFile(sourcePath);
    const folder = join(root, "photos");
    mkdirSync(folder);
    const result = await createPhotoCopies({
      sourcePath,
      folder,
      photoId: "large",
      heic: false,
    });
    expect(result).toMatchObject({
      widthPx: 1000,
      heightPx: 2000,
      orientation: 8,
      visionWidthPx: 784,
      visionHeightPx: 1568,
    });
    expect(
      await sharp(join(folder, "vision", "large.jpg")).metadata(),
    ).toMatchObject({ width: 784, height: 1568 });
    const thumb = await sharp(join(folder, "thumb", "large.jpg")).metadata();
    expect(thumb).toMatchObject({ width: 120, height: 240 });
    expect(thumb.orientation).toBeUndefined();
    expect(Number.isFinite(result.blurScore)).toBe(true);
    expect((await sharp(sourcePath).metadata()).orientation).toBe(8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
