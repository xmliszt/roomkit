import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { getSurfaceAssetLabel } from "./get-surface-asset-label.ts";
import { getSurfaceAssetOptions } from "./get-surface-asset-options.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 5,
  ceilingHeightM: 2.6,
}).room;
const common = {
  assetId: "sample",
  color: "#ffffff",
  roughness: 0.4,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const texture = {
  ...common,
  kind: "texture",
  repeatSizeM: { u: 0.27, v: 0.22 },
} satisfies SurfaceAsset;
const tiles = {
  ...common,
  kind: "tiles",
  tileSizeM: { u: 0.8, v: 0.8 },
} satisfies SurfaceAsset;
const planks = {
  ...common,
  kind: "planks",
  plankSizeM: { u: 0.18, v: 1.2 },
} satisfies SurfaceAsset;

for (const entry of [
  {
    asset: { ...texture, sourceSurfaceId: "floor" },
    expected: "Floor texture · 0.27 × 0.22 m",
  },
  {
    asset: { ...texture, sourceSurfaceId: "ceiling" },
    expected: "Ceiling texture · 0.27 × 0.22 m",
  },
  {
    asset: { ...texture, sourceSurfaceId: "wall-3" },
    expected: "Wallpaper · from wall 3 · 0.27 × 0.22 m",
  },
  { asset: texture, expected: "Texture · 0.27 × 0.22 m" },
  {
    asset: { ...tiles, sourceSurfaceId: "floor" },
    expected: "Floor tiles · 0.80 m",
  },
  {
    asset: { ...tiles, sourceSurfaceId: "ceiling" },
    expected: "Ceiling tiles · 0.80 m",
  },
  {
    asset: { ...tiles, sourceSurfaceId: "wall-3" },
    expected: "Wall tiles · from wall 3 · 0.80 m",
  },
  { asset: tiles, expected: "Tiles · 0.80 m" },
  {
    asset: { ...planks, sourceSurfaceId: "floor" },
    expected: "Floor planks · 0.18 × 1.20 m",
  },
  {
    asset: { ...planks, sourceSurfaceId: "ceiling" },
    expected: "Ceiling planks · 0.18 × 1.20 m",
  },
  {
    asset: { ...planks, sourceSurfaceId: "wall-3" },
    expected: "Wall planks · from wall 3 · 0.18 × 1.20 m",
  },
  { asset: planks, expected: "Planks · 0.18 × 1.20 m" },
  {
    asset: { ...texture, sourceSurfaceId: "removed-wall-id" },
    expected: "Texture · 0.27 × 0.22 m",
  },
]) {
  test(entry.expected, () =>
    expect(getSurfaceAssetLabel({ asset: entry.asset, room })).toBe(
      entry.expected,
    ),
  );
}

test("wall labels retain room order across open walls", () => {
  expect(
    getSurfaceAssetLabel({
      asset: { ...planks, sourceSurfaceId: "wall-3" },
      room: {
        ...room,
        walls: room.walls.map((wall) =>
          wall.id === "wall-2" ? { ...wall, kind: "open" } : wall,
        ),
      },
    }),
  ).toBe("Wall planks · from wall 3 · 0.18 × 1.20 m");
});

test("duplicate labels are numbered oldest first while options stay newest first", () => {
  const assets = [
    { ...texture, assetId: "newest", createdAt: "2026-03-01T00:00:00.000Z" },
    { ...texture, assetId: "middle", createdAt: "2026-02-01T00:00:00.000Z" },
    { ...texture, assetId: "oldest", createdAt: "2026-01-01T00:00:00.000Z" },
    { ...tiles, assetId: "different" },
  ];
  expect(
    getSurfaceAssetOptions({ assets, room }).map((entry) => entry.label),
  ).toEqual([
    "Texture · 0.27 × 0.22 m · 3",
    "Texture · 0.27 × 0.22 m · 2",
    "Texture · 0.27 × 0.22 m",
    "Tiles · 0.80 m",
  ]);
});
