import { describe, expect, test } from "vitest";
import { createRectangularScene } from "../scene/create-rectangular-scene.ts";
import type { Scene } from "../scene/scene-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import { applyCommand } from "./apply-command.ts";
import { buildItem } from "./build-item.ts";
import { buildTestScene } from "./build-test-scene.ts";
import type { Command } from "./command-schema.ts";
import { CommandSchema } from "./command-schema.ts";
import { invertCommand } from "./invert-command.ts";

function apply(options: { scene: Scene; command: Command }) {
  const result = applyCommand(options);
  if (result.kind === "rejected") throw new Error(result.reason);
  return result.scene;
}

function reasonFor(command: Command) {
  const result = applyCommand({ scene: buildTestScene(), command });
  return result.kind === "rejected" ? result.reason : undefined;
}

function resizedWalls(options: { widthM: number; depthM: number }) {
  return createRectangularScene({ ...options, ceilingHeightM: 2.6 }).room.walls;
}

const chair = buildItem({
  id: "chair",
  placement: {
    kind: "floor",
    xM: 0.5,
    zM: 0.5,
    elevationM: 0,
    rotationRad: 0,
  },
});

const commands: { [name: string]: Command } = {
  "item.add at the end": { type: "item.add", item: chair },
  "item.add at an index": { type: "item.add", item: chair, index: 1 },
  "item.update of every field": {
    type: "item.update",
    itemId: "sofa",
    patch: {
      name: "Blue sofa",
      model: { kind: "asset", assetId: "asset-other" },
      placement: {
        kind: "wall",
        wallId: "wall-3",
        alongM: 0.5,
        heightM: 1,
        rotationRad: 0,
      },
      sizeM: { width: 2.1, height: 0.8, depth: 0.9 },
      colorAdjust: {
        kind: "shift",
        hueShiftDeg: 40,
        saturation: 0.1,
        lightness: -0.2,
      },
      locked: true,
    },
  },
  "item.update that clears colorAdjust": {
    type: "item.update",
    itemId: "sofa",
    patch: { colorAdjust: null },
  },
  "item.update that sets colorAdjust where there was none": {
    type: "item.update",
    itemId: "table",
    patch: { colorAdjust: { kind: "colorize", color: "#ffffff", strength: 1 } },
  },
  "item.update from pending to asset": {
    type: "item.update",
    itemId: "box",
    patch: {
      model: { kind: "asset", assetId: "asset-box" },
      sizeM: { width: 0.4, height: 0.4, depth: 0.4 },
    },
  },
  "item.update that switches a wall item to another asset": {
    type: "item.update",
    itemId: "port",
    patch: {
      model: { kind: "asset", assetId: "charging-port-type-c-f" },
      sizeM: { width: 0.08, height: 0.08, depth: 0.011 },
    },
  },
  "item.duplicate": {
    type: "item.duplicate",
    itemId: "sofa",
    newItemId: "sofa-2",
    placement: {
      kind: "floor",
      xM: 0,
      zM: 1,
      elevationM: 0,
      rotationRad: 0.3,
    },
  },
  "item.remove of the first item": { type: "item.remove", itemId: "sofa" },
  "item.remove of a middle item": { type: "item.remove", itemId: "table" },
  "item.remove of the last item": { type: "item.remove", itemId: "box" },
  "room.update of the walls with floor items present": {
    type: "room.update",
    walls: resizedWalls({ widthM: 4.73, depthM: 5.31 }),
  },
  "room.update of the ceiling height": {
    type: "room.update",
    ceilingHeightM: 2.75,
  },
  "room.update with a given placement": {
    type: "room.update",
    walls: resizedWalls({ widthM: 3.1, depthM: 5 }),
    placements: {
      sofa: {
        kind: "floor",
        xM: 0,
        zM: 0,
        elevationM: 0,
        rotationRad: 0,
      },
      port: {
        kind: "wall",
        wallId: "wall-4",
        alongM: 2,
        heightM: 0.3,
        rotationRad: 0,
      },
    },
  },
  "room.update to walls with other ids": {
    type: "room.update",
    walls: [
      { id: "wall-1", startM: { x: -2, z: -2.5 }, kind: "solid" },
      { id: "wall-2", startM: { x: -2, z: 2.5 }, kind: "inferred" },
      { id: "wall-5", startM: { x: 0, z: 3.5 }, kind: "open" },
      { id: "wall-3", startM: { x: 2, z: 2.5 }, kind: "solid" },
      { id: "wall-4", startM: { x: 2, z: -2.5 }, kind: "solid" },
    ],
  },
  "surface.update that adds a colour": {
    type: "surface.update",
    surfaceId: "wall-2",
    color: "#ffffff",
  },
  "surface.update that changes a colour": {
    type: "surface.update",
    surfaceId: "floor",
    color: "#000000",
  },
  "surface.update that removes a colour": {
    type: "surface.update",
    surfaceId: "floor",
    color: null,
  },
  "camera.set": {
    type: "camera.set",
    camera: {
      positionM: { x: 1, y: 2, z: 3 },
      targetM: { x: 0, y: 1, z: 0 },
    },
  },
};

describe.each(Object.entries(commands))("%s", (_name, command) => {
  test("gives a valid scene and leaves the input unchanged", () => {
    const scene = buildTestScene();
    const next = apply({ scene, command: CommandSchema.parse(command) });
    expect(scene).toStrictEqual(buildTestScene());
    expect(next).not.toStrictEqual(scene);
    expect(SceneSchema.parse(next)).toStrictEqual(next);
  });

  test("its inverse restores the scene exactly, and the inverse of that redoes it", () => {
    const scene = buildTestScene();
    const next = apply({ scene, command });
    const inverse = invertCommand({ scene, command });
    if (inverse === undefined) throw new Error("No inverse");
    expect(CommandSchema.parse(inverse)).toStrictEqual(inverse);
    const restored = apply({ scene: next, command: inverse });
    expect(restored).toStrictEqual(scene);
    expect(JSON.parse(JSON.stringify(restored))).toStrictEqual(scene);
    const redo = invertCommand({ scene: next, command: inverse });
    if (redo === undefined) throw new Error("No redo");
    expect(apply({ scene: restored, command: redo })).toStrictEqual(next);
  });

  test("gives the same scene when applied twice from the same input", () => {
    expect(apply({ scene: buildTestScene(), command })).toStrictEqual(
      apply({ scene: buildTestScene(), command }),
    );
  });
});

test("item.add puts the item at the index, or at the end without one", () => {
  const ids = (command: Command) =>
    apply({ scene: buildTestScene(), command }).items.map((item) => item.id);
  expect(ids({ type: "item.add", item: chair })).toStrictEqual([
    "sofa",
    "port",
    "table",
    "lamp",
    "box",
    "chair",
  ]);
  expect(ids({ type: "item.add", item: chair, index: 1 })).toStrictEqual([
    "sofa",
    "chair",
    "port",
    "table",
    "lamp",
    "box",
  ]);
});

test("item.update that clears colorAdjust removes the key", () => {
  const next = apply({
    scene: buildTestScene(),
    command: {
      type: "item.update",
      itemId: "sofa",
      patch: { colorAdjust: null },
    },
  });
  expect(Object.keys(next.items.at(0) ?? {})).not.toContain("colorAdjust");
});

test("item.update ignores a patch key set to undefined", () => {
  const scene = buildTestScene();
  const next = apply({
    scene,
    command: {
      type: "item.update",
      itemId: "sofa",
      patch: { name: undefined, colorAdjust: undefined, locked: true },
    },
  });
  expect(next.items.at(0)).toStrictEqual({
    ...scene.items.at(0),
    locked: true,
  });
});

test("item.duplicate copies everything but the id and the placement", () => {
  const scene = buildTestScene();
  const command = commands["item.duplicate"];
  if (command?.type !== "item.duplicate") throw new Error("Wrong fixture");
  const next = apply({ scene, command });
  expect(next.items.at(-1)).toStrictEqual({
    ...scene.items.at(0),
    id: "sofa-2",
    placement: command.placement,
  });
});

test("room.update moves each floor item with its nearest wall and keeps wall and ceiling items", () => {
  const scene = buildTestScene();
  const next = apply({
    scene,
    command: {
      type: "room.update",
      walls: resizedWalls({ widthM: 5, depthM: 6 }),
    },
  });
  const placements = Object.fromEntries(
    next.items.map((item) => [item.id, item.placement]),
  );
  expect(placements.sofa).toMatchObject({ xM: -1.87, zM: 0.21 });
  expect(placements.table).toMatchObject({ xM: 2.13, zM: -0.47 });
  expect(placements.box).toMatchObject({ xM: 0.13, zM: 2.67 });
  expect(placements.port).toStrictEqual(scene.items.at(1)?.placement);
  expect(placements.lamp).toStrictEqual(scene.items.at(3)?.placement);
});

test("room.update gives a floor item that is the same distance from two walls to the earlier wall", () => {
  const scene = {
    ...buildTestScene(),
    items: [
      buildItem({
        id: "corner",
        placement: {
          kind: "floor",
          xM: -1.5,
          zM: -2,
          elevationM: 0,
          rotationRad: 0,
        },
      }),
    ],
  };
  const next = apply({
    scene,
    command: {
      type: "room.update",
      walls: resizedWalls({ widthM: 5, depthM: 6 }),
    },
  });
  expect(next.items.at(0)?.placement).toMatchObject({ xM: -2, zM: -2 });
});

test("room.update leaves floor items in place when the wall ids change", () => {
  const scene = buildTestScene();
  const command = commands["room.update to walls with other ids"];
  if (command === undefined) throw new Error("Wrong fixture");
  expect(apply({ scene, command }).items).toStrictEqual(scene.items);
});

describe("rejects", () => {
  const rejections: { [name: string]: Command } = {
    "item.add with an id already in use": {
      type: "item.add",
      item: { ...chair, id: "sofa" },
    },
    "item.add past the end of the list": {
      type: "item.add",
      item: chair,
      index: 6,
    },
    "item.add on a wall that does not exist": {
      type: "item.add",
      item: buildItem({
        id: "shelf",
        placement: {
          kind: "wall",
          wallId: "wall-9",
          alongM: 0,
          heightM: 1,
          rotationRad: 0,
        },
      }),
    },
    "item.update of an unknown item": {
      type: "item.update",
      itemId: "ghost",
      patch: { locked: true },
    },
    "item.update onto a wall that does not exist": {
      type: "item.update",
      itemId: "sofa",
      patch: {
        placement: {
          kind: "wall",
          wallId: "wall-9",
          alongM: 0,
          heightM: 1,
          rotationRad: 0,
        },
      },
    },
    "item.duplicate of an unknown item": {
      type: "item.duplicate",
      itemId: "ghost",
      newItemId: "ghost-2",
      placement: chair.placement,
    },
    "item.duplicate onto an id already in use": {
      type: "item.duplicate",
      itemId: "sofa",
      newItemId: "table",
      placement: chair.placement,
    },
    "item.duplicate of a pending item": {
      type: "item.duplicate",
      itemId: "box",
      newItemId: "box-2",
      placement: chair.placement,
    },
    "item.remove of an unknown item": { type: "item.remove", itemId: "ghost" },
    "room.update that changes nothing": { type: "room.update" },
    "room.update that drops a wall an item is on": {
      type: "room.update",
      walls: [
        { id: "wall-1", startM: { x: -2, z: -2.5 }, kind: "solid" },
        { id: "wall-3", startM: { x: 2, z: 2.5 }, kind: "solid" },
        { id: "wall-4", startM: { x: 2, z: -2.5 }, kind: "solid" },
      ],
    },
    "room.update that opens a wall an item is on": {
      type: "room.update",
      walls: resizedWalls({ widthM: 4, depthM: 5 }).map((wall) =>
        wall.id === "wall-2" ? { ...wall, kind: "open" } : wall,
      ),
    },
    "room.update with two walls of the same id": {
      type: "room.update",
      walls: resizedWalls({ widthM: 4, depthM: 5 }).map((wall) =>
        wall.id === "wall-4" ? { ...wall, id: "wall-3" } : wall,
      ),
    },
    "room.update with a wall of no length": {
      type: "room.update",
      walls: [
        ...resizedWalls({ widthM: 4, depthM: 5 }),
        { id: "wall-5", startM: { x: 2, z: -2.5 }, kind: "solid" },
      ],
    },
    "room.update with a placement for an unknown item": {
      type: "room.update",
      placements: { ghost: chair.placement },
    },
    "surface.update of a surface that does not exist": {
      type: "surface.update",
      surfaceId: "wall-9",
      color: "#ffffff",
    },
    "item.update to a job that already fills an item": {
      type: "item.update",
      itemId: "table",
      patch: { model: { kind: "pending", jobId: "job-1" } },
    },
    "surface.update that removes a colour that is not set": {
      type: "surface.update",
      surfaceId: "wall-2",
      color: null,
    },
  };

  const reasons: { [name: string]: string } = {
    "item.add with an id already in use": "Item id sofa is used more than once",
    "item.add past the end of the list":
      "Index 6 is past the end of the item list",
    "item.add on a wall that does not exist":
      "Item shelf is on wall wall-9, which does not exist",
    "item.update of an unknown item": "Item ghost does not exist",
    "item.update onto a wall that does not exist":
      "Item sofa is on wall wall-9, which does not exist",
    "item.duplicate of an unknown item": "Item ghost does not exist",
    "item.duplicate onto an id already in use":
      "Item id table is used more than once",
    "item.duplicate of a pending item": "Item box is still generating",
    "item.remove of an unknown item": "Item ghost does not exist",
    "room.update that changes nothing": "The command changes nothing",
    "room.update that drops a wall an item is on":
      "Item port is on wall wall-2, which does not exist",
    "room.update that opens a wall an item is on":
      "Item port is on wall wall-2, which is open",
    "room.update with two walls of the same id":
      "Wall id wall-3 is used more than once",
    "room.update with a wall of no length": "Wall wall-4 has no length",
    "room.update with a placement for an unknown item":
      "Item ghost does not exist",
    "surface.update of a surface that does not exist":
      "Surface wall-9 is not floor, ceiling or a wall",
    "item.update to a job that already fills an item":
      "Job job-1 fills more than one item",
    "surface.update that removes a colour that is not set":
      "Surface wall-2 has no colour to remove",
  };

  test.each(Object.entries(rejections))("%s", (name, command) => {
    expect(reasons[name]).toEqual(expect.any(String));
    expect(CommandSchema.safeParse(command).success).toBe(true);
    expect(reasonFor(command)).toBe(reasons[name]);
  });

  test("room.update that drops a wall a surface uses", () => {
    const scene = apply({
      scene: { ...buildTestScene(), items: [] },
      command: {
        type: "surface.update",
        surfaceId: "wall-2",
        color: "#ffffff",
      },
    });
    const result = applyCommand({
      scene,
      command: {
        type: "room.update",
        walls: scene.room.walls.filter((wall) => wall.id !== "wall-2"),
      },
    });
    expect(result.kind).toBe("rejected");
  });
});

describe("the schema rejects", () => {
  const invalid: { [name: string]: unknown } = {
    "an unknown type": { type: "item.move", itemId: "sofa" },
    "an unknown key": { type: "item.remove", itemId: "sofa", extra: 1 },
    "item.add without an id": {
      type: "item.add",
      item: { ...chair, id: "" },
    },
    "item.add with a negative size": {
      type: "item.add",
      item: { ...chair, sizeM: { width: -1, height: 1, depth: 1 } },
    },
    "item.add with a negative index": {
      type: "item.add",
      item: chair,
      index: -1,
    },
    "item.update with an empty patch": {
      type: "item.update",
      itemId: "sofa",
      patch: {},
    },
    "item.update of the id": {
      type: "item.update",
      itemId: "sofa",
      patch: { id: "other" },
    },
    "item.update with a number that is not finite": {
      type: "item.update",
      itemId: "sofa",
      patch: {
        placement: {
          kind: "floor",
          xM: Number.NaN,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    },
    "item.update with a colour that is not hex": {
      type: "item.update",
      itemId: "sofa",
      patch: { colorAdjust: { kind: "colorize", color: "blue", strength: 1 } },
    },
    "item.duplicate without a new id": {
      type: "item.duplicate",
      itemId: "sofa",
      placement: chair.placement,
    },
    "room.update with two walls": {
      type: "room.update",
      walls: resizedWalls({ widthM: 4, depthM: 5 }).slice(0, 2),
    },
    "room.update with a ceiling height of zero": {
      type: "room.update",
      ceilingHeightM: 0,
    },
    "surface.update with a colour that is not hex": {
      type: "surface.update",
      surfaceId: "floor",
      color: "red",
    },
    "camera.set without a target": {
      type: "camera.set",
      camera: { positionM: { x: 0, y: 0, z: 0 } },
    },
  };

  test.each(Object.entries(invalid))("%s", (_name, command) => {
    expect(CommandSchema.safeParse(command).success).toBe(false);
  });
});

test("invertCommand gives nothing for an item the scene does not hold", () => {
  const scene = buildTestScene();
  expect(
    invertCommand({ scene, command: { type: "item.remove", itemId: "ghost" } }),
  ).toBeUndefined();
  expect(
    invertCommand({
      scene,
      command: {
        type: "item.update",
        itemId: "ghost",
        patch: { locked: true },
      },
    }),
  ).toBeUndefined();
});

test("room.update leaves an item alone when its id is the name of an Object.prototype member", () => {
  const item = { ...chair, id: "constructor" };
  const scene = apply({
    scene: buildTestScene(),
    command: { type: "item.add", item },
  });
  const next = apply({
    scene,
    command: { type: "room.update", ceilingHeightM: 3 },
  });
  expect(next.items.at(-1)).toStrictEqual(item);
  const inverse = invertCommand({
    scene: next,
    command: { type: "surface.update", surfaceId: "constructor", color: null },
  });
  expect(inverse).toMatchObject({ color: null });
});

test("rejects a room.update whose walls run clockwise", () => {
  expect(
    reasonFor({
      type: "room.update",
      walls: resizedWalls({ widthM: 4, depthM: 5 }).toReversed(),
    }),
  ).toBe("Walls do not run counter-clockwise");
});

test("rejects a command whose result holds a number that is not finite", () => {
  const scene = apply({
    scene: buildTestScene(),
    command: {
      type: "room.update",
      walls: resizedWalls({ widthM: 4, depthM: 5 }).map((wall) => ({
        ...wall,
        startM: {
          x: Math.sign(wall.startM.x) * 1e308,
          z: Math.sign(wall.startM.z) * 1e308,
        },
      })),
      placements: Object.fromEntries(
        buildTestScene()
          .items.filter((item) => item.placement.kind === "floor")
          .map((item) => [item.id, item.placement]),
      ),
    },
  });
  const result = applyCommand({
    scene,
    command: { type: "room.update", ceilingHeightM: 3 },
  });
  expect(result.kind).toBe("rejected");
});

test("the schema rejects an id that could be a path or `__proto__`", () => {
  for (const id of ["__proto__", "../up", "a/b", "", "a".repeat(65)])
    expect(
      CommandSchema.safeParse({ type: "item.remove", itemId: id }).success,
    ).toBe(false);
});
