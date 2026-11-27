import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import { expect, test } from "vitest";
import { getGroupPlacementCommands } from "./get-group-placement-commands.ts";

const room = createRectangularScene({
  widthM: 6,
  depthM: 6,
  ceilingHeightM: 3,
}).room;
const floor = {
  kind: "floor",
  xM: 0,
  zM: 0,
  elevationM: 0,
  rotationRad: 0,
} satisfies Placement;
const wall = {
  kind: "wall",
  wallId: "wall-1",
  alongM: 3,
  heightM: 1,
  rotationRad: 0,
} satisfies Placement;
const sizeM = { width: 1, height: 1, depth: 1 };

test("floor motion applies literal offsets and skips locked and unselected items", () => {
  const items = [
    buildItem({ id: "a", placement: floor }),
    buildItem({
      id: "b",
      placement: { ...floor, xM: 1, zM: 1, elevationM: 0.2 },
    }),
    { ...buildItem({ id: "locked", placement: floor }), locked: true },
    buildItem({ id: "other", placement: floor }),
  ];
  expect(
    getGroupPlacementCommands({
      items,
      selectedIds: ["a", "b", "locked"],
      itemId: "a",
      room,
      placement: { ...floor, xM: 0.5, zM: -1 },
    }),
  ).toEqual([
    {
      type: "item.update",
      itemId: "a",
      patch: { placement: { ...floor, xM: 0.5, zM: -1 } },
    },
    {
      type: "item.update",
      itemId: "b",
      patch: { placement: { ...floor, xM: 1.5, zM: 0, elevationM: 0.2 } },
    },
  ]);
});

test("the tightest wall edge clamps the shared offset for a 6 m wall", () => {
  const items = [
    { ...buildItem({ id: "source", placement: wall }), sizeM },
    {
      ...buildItem({ id: "member", placement: { ...wall, alongM: 5.4 } }),
      sizeM,
    },
  ];
  const commands = getGroupPlacementCommands({
    items,
    selectedIds: items.map((item) => item.id),
    itemId: "source",
    room,
    placement: { ...wall, alongM: 3.5 },
  });
  expect(commands).toEqual([
    {
      type: "item.update",
      itemId: "source",
      patch: { placement: { ...wall, alongM: expect.closeTo(3.1, 10) } },
    },
    {
      type: "item.update",
      itemId: "member",
      patch: { placement: { ...wall, alongM: 5.5 } },
    },
  ]);
});

test("floor and ceiling members clamp a common horizontal offset at the room edge", () => {
  const ceiling = {
    kind: "ceiling",
    xM: 2.4,
    zM: 2.4,
    rotationRad: 0,
  } satisfies Placement;
  const items = [
    { ...buildItem({ id: "source", placement: floor }), sizeM },
    { ...buildItem({ id: "member", placement: ceiling }), sizeM },
  ];
  const commands = getGroupPlacementCommands({
    items,
    selectedIds: ["source", "member"],
    itemId: "source",
    room,
    placement: { ...floor, xM: 1, zM: 1 },
  });
  expect(commands.at(0)).toMatchObject({
    patch: {
      placement: { xM: expect.closeTo(0.1, 10), zM: expect.closeTo(0.1, 10) },
    },
  });
  expect(commands.at(1)).toMatchObject({
    patch: { placement: { xM: 2.5, zM: 2.5 } },
  });
});

test("wall members share the tightest floor and ceiling height limits", () => {
  const items = [
    { ...buildItem({ id: "high", placement: { ...wall, heightM: 2 } }), sizeM },
    {
      ...buildItem({ id: "low", placement: { ...wall, heightM: 0.75 } }),
      sizeM,
    },
  ];
  const commands = getGroupPlacementCommands({
    items,
    selectedIds: ["high", "low"],
    itemId: "high",
    room,
    placement: { ...wall, heightM: 0 },
  });
  expect(commands.at(0)).toMatchObject({
    patch: { placement: { heightM: 1.75 } },
  });
  expect(commands.at(1)).toMatchObject({
    patch: { placement: { heightM: 0.5 } },
  });
  const raised = getGroupPlacementCommands({
    items,
    selectedIds: ["high", "low"],
    itemId: "low",
    room,
    placement: { ...wall, heightM: 3 },
  });
  expect(raised.at(0)).toMatchObject({
    patch: { placement: { heightM: 2.5 } },
  });
  expect(raised.at(1)).toMatchObject({
    patch: { placement: { heightM: 1.25 } },
  });
});

test("wall motion leaves other walls fixed and respects a floor member at the room edge", () => {
  const items = [
    { ...buildItem({ id: "source", placement: wall }), sizeM },
    { ...buildItem({ id: "floor", placement: { ...floor, zM: 2.4 } }), sizeM },
    buildItem({ id: "other-wall", placement: { ...wall, wallId: "wall-2" } }),
  ];
  const commands = getGroupPlacementCommands({
    items,
    selectedIds: items.map((item) => item.id),
    itemId: "source",
    room,
    placement: { ...wall, alongM: 4 },
  });
  expect(
    commands.map((command) => command.type === "item.update" && command.itemId),
  ).toEqual(["source", "floor"]);
  expect(commands.at(0)).toMatchObject({
    patch: { placement: { alongM: 3.1 } },
  });
  expect(commands.at(1)).toMatchObject({
    patch: { placement: { xM: 0, zM: 2.5 } },
  });
});

test("rotation keeps centres and turns floor and ceiling together, separately from walls", () => {
  const items = [
    buildItem({ id: "floor", placement: floor }),
    buildItem({ id: "wall", placement: { ...wall, rotationRad: 0.2 } }),
    buildItem({
      id: "ceiling",
      placement: { kind: "ceiling", xM: 2, zM: 1, rotationRad: 0.4 },
    }),
    buildItem({
      id: "wall-2",
      placement: { ...wall, wallId: "wall-2", rotationRad: 0.3 },
    }),
  ];
  const selectedIds = items.map((item) => item.id);
  const commands = getGroupPlacementCommands({
    items,
    selectedIds,
    itemId: "floor",
    room,
    placement: { ...floor, rotationRad: 0.5 },
  });
  expect(commands).toEqual([
    {
      type: "item.update",
      itemId: "floor",
      patch: { placement: { ...floor, rotationRad: 0.5 } },
    },
    {
      type: "item.update",
      itemId: "ceiling",
      patch: { placement: { kind: "ceiling", xM: 2, zM: 1, rotationRad: 0.9 } },
    },
  ]);
  const walls = getGroupPlacementCommands({
    items,
    selectedIds,
    itemId: "wall",
    room,
    placement: { ...wall, rotationRad: 0.7 },
  });
  expect(
    walls.map((command) => command.type === "item.update" && command.itemId),
  ).toEqual(["wall", "wall-2"]);
});

test("a locked rotation source stays fixed and rotates only matching unlocked mounts", () => {
  const items = [
    { ...buildItem({ id: "locked", placement: floor }), locked: true },
    buildItem({ id: "free", placement: floor }),
    buildItem({ id: "wall", placement: wall }),
  ];
  expect(
    getGroupPlacementCommands({
      items,
      selectedIds: items.map((item) => item.id),
      itemId: "locked",
      room,
      placement: { ...floor, rotationRad: 0.5 },
    }),
  ).toEqual([
    {
      type: "item.update",
      itemId: "free",
      patch: { placement: { ...floor, rotationRad: 0.5 } },
    },
  ]);
});

test("a drag of an unselected item moves only it while a group stays on its source wall", () => {
  const items = [
    buildItem({ id: "a", placement: wall }),
    buildItem({ id: "b", placement: wall }),
  ];
  const next = { ...wall, wallId: "wall-2" };
  expect(
    getGroupPlacementCommands({
      items,
      selectedIds: ["a", "b"],
      itemId: "a",
      room,
      placement: next,
    }),
  ).toEqual([]);
  expect(
    getGroupPlacementCommands({
      items,
      selectedIds: ["old", "selection"],
      itemId: "a",
      room,
      placement: next,
    }),
  ).toEqual([{ type: "item.update", itemId: "a", patch: { placement: next } }]);
});
