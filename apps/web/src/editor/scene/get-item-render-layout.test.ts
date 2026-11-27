import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test } from "vitest";
import { getItemRenderLayout } from "./get-item-render-layout.ts";

test.each([
  { height: 0.005, offsetM: 0.001 },
  { height: 0.03, offsetM: 0.001 },
  { height: 0.030001, offsetM: 0 },
])("floor item $height m gets render offset $offsetM m", (options) => {
  const item = {
    id: "rug",
    name: "Rug",
    model: { kind: "asset", assetId: "rug" },
    sizeM: { width: 2, height: options.height, depth: 1.4 },
    placement: {
      kind: "floor",
      xM: 0.4,
      zM: 0.3,
      elevationM: 0.2,
      rotationRad: 0.5,
    },
    locked: false,
  } satisfies Item;
  const original = structuredClone(item);
  const layout = getItemRenderLayout({
    item,
    segments: [],
    ceilingHeightM: 2.6,
  });
  expect(layout?.frame.positionM).toEqual({
    x: 0.4,
    y: 0.2 + options.offsetM,
    z: 0.3,
  });
  expect(layout?.sizeM).toEqual(item.sizeM);
  expect(item).toEqual(original);
});
