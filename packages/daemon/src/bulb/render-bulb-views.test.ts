import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { generationFixture } from "../../../../apps/web/e2e/generation-fixture.ts";
import { buildGlb } from "../../../../apps/web/src/capture/e2e/build-glb.ts";
import { renderBulbViews } from "./render-bulb-views.ts";

const blender = ["/opt/homebrew/bin/blender", "/usr/local/bin/blender"].find(
  existsSync,
);
const boxM = { width: 1, height: 2, depth: 0.5 };
const minM = { x: -0.5, y: 0, z: -0.25 };
const cornerM = 0.02;
const markerM = 0.06;
const marker = { x: 0.8, y: 0.9, z: 0.2 };

function buildMarkerGlb() {
  const fixture = generationFixture({ color: [0.9, 0.1, 0.1] });
  const length = fixture.glb.readUInt32LE(12);
  const original = JSON.parse(fixture.glb.subarray(20, 20 + length).toString());
  const markerCentre = {
    x: minM.x + marker.x * boxM.width,
    y: minM.y + marker.y * boxM.height,
    z: minM.z + marker.z * boxM.depth,
  };
  const nodes = [
    {
      mesh: 0,
      translation: [minM.x + cornerM / 2, minM.y, minM.z + cornerM / 2],
      scale: [cornerM, cornerM, cornerM],
    },
    {
      mesh: 0,
      translation: [
        minM.x + boxM.width - cornerM / 2,
        minM.y + boxM.height - cornerM,
        minM.z + boxM.depth - cornerM / 2,
      ],
      scale: [cornerM, cornerM, cornerM],
    },
    {
      mesh: 0,
      translation: [
        markerCentre.x,
        markerCentre.y - markerM / 2,
        markerCentre.z,
      ],
      scale: [markerM, markerM, markerM],
    },
  ];
  return buildGlb({
    json: { ...original, scenes: [{ nodes: [0, 1, 2] }], nodes },
    binary: fixture.glb.subarray(28 + length),
  });
}

async function findMarker(path: string) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cornerPx = Math.max(info.width, info.height) * 0.06;
  const pixels = Array.from(
    { length: info.width * info.height },
    (_, index) => ({
      x: index % info.width,
      y: Math.floor(index / info.width),
      alpha: data[index * 4 + 3] ?? 0,
    }),
  ).filter(
    (pixel) =>
      pixel.alpha > 128 &&
      !(
        (pixel.x < cornerPx || pixel.x > info.width - cornerPx) &&
        (pixel.y < cornerPx || pixel.y > info.height - cornerPx)
      ),
  );
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    across: mean(pixels.map((pixel) => pixel.x + 0.5)) / info.width,
    up: 1 - mean(pixels.map((pixel) => pixel.y + 0.5)) / info.height,
    aspect: info.width / info.height,
  };
}

test.skipIf(blender === undefined)(
  "front and side views map box fractions linearly to the image",
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "bulb-views-"));
    try {
      const modelPath = join(folder, "model.glb");
      writeFileSync(modelPath, buildMarkerGlb());
      const views = await renderBulbViews({
        blender: blender ?? "",
        modelPath,
        folder,
        env: process.env,
        processPath: join(folder, "worker.json"),
        signal: new AbortController().signal,
        onLine: () => undefined,
      });
      expect(existsSync(views.frontPath)).toBe(true);
      expect(existsSync(views.sidePath)).toBe(true);
      const front = await findMarker(join(folder, "front-render.png"));
      const side = await findMarker(join(folder, "side-render.png"));
      expect(front.aspect).toBeCloseTo(boxM.width / boxM.height, 1);
      expect(side.aspect).toBeCloseTo(boxM.depth / boxM.height, 1);
      expect(Math.abs(front.across - marker.x)).toBeLessThan(0.02);
      expect(Math.abs(front.up - marker.y)).toBeLessThan(0.02);
      expect(Math.abs(side.across - marker.z)).toBeLessThan(0.02);
      expect(Math.abs(side.up - marker.y)).toBeLessThan(0.02);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  },
  120_000,
);
