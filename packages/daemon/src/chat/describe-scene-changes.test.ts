import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { expect, test } from "vitest";
import { describeSceneChanges } from "./describe-scene-changes.ts";

const empty = createRectangularScene({
  widthM: 4,
  depthM: 5,
  ceilingHeightM: 2.6,
});
const before: Scene = {
  ...empty,
  items: [
    {
      id: "port",
      name: CHARGING_PORT.name,
      model: { kind: "asset", assetId: CHARGING_PORT.assetId },
      placement: {
        kind: "wall",
        wallId: "wall-2",
        alongM: 1.2,
        heightM: 0.3,
        rotationRad: 0,
      },
      sizeM: CHARGING_PORT.sizeM,
      locked: false,
    },
  ],
};

test("labels a wall move with the item name and the field, in meters", () => {
  const after: Scene = {
    ...before,
    items: before.items.map((item) =>
      item.placement.kind === "wall"
        ? { ...item, placement: { ...item.placement, alongM: 1.7 } }
        : item,
    ),
  };
  expect(describeSceneChanges({ before, after })).toStrictEqual([
    { label: "Charging port · alongM", before: "1.20 m", after: "1.70 m" },
  ]);
});

test("shows a rename and a removed item", () => {
  const renamed: Scene = {
    ...before,
    items: before.items.map((item) => ({ ...item, name: "Outlet" })),
  };
  expect(describeSceneChanges({ before, after: renamed })).toStrictEqual([
    { label: "Charging port · name", before: "Charging port", after: "Outlet" },
  ]);
  expect(
    describeSceneChanges({ before, after: { ...before, items: [] } }).at(0),
  ).toMatchObject({ label: "Charging port · name", after: "—" });
});
