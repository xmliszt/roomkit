import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { getItemSphere } from "./get-item-sphere.ts";
import { getSelectionSphere } from "./get-selection-sphere.ts";

test("the frame sphere includes every selected box and ignores unselected items", () => {
  const room = createRectangularScene({
    widthM: 10,
    depthM: 10,
    ceilingHeightM: 3,
  }).room;
  const items = [-3, 3, 8].map((xM, index) =>
    buildItem({
      id: String(index),
      placement: { kind: "floor", xM, zM: 0, elevationM: 0, rotationRad: 0 },
    }),
  );
  const sphere = getSelectionSphere({ room, items, selectedIds: ["0", "1"] });
  if (!sphere) throw new Error("Missing selection sphere");
  for (const item of items.slice(0, 2)) {
    const member = getItemSphere({ item, room });
    if (!member) throw new Error("Missing item sphere");
    expect(
      Math.hypot(
        sphere.centerM.x - member.centerM.x,
        sphere.centerM.y - member.centerM.y,
        sphere.centerM.z - member.centerM.z,
      ) + member.radiusM,
    ).toBeLessThanOrEqual(sphere.radiusM + 1e-10);
  }
  expect(sphere.centerM.x).toBe(0);
  const first = items.at(0);
  if (!first) throw new Error("Missing first item");
  expect(getSelectionSphere({ room, items, selectedIds: ["0"] })).toEqual(
    getItemSphere({ room, item: first }),
  );
  expect(getSelectionSphere({ room, items, selectedIds: [] })).toBeUndefined();
});
