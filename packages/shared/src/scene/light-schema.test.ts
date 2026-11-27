import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ProjectSchema } from "../project/project-schema.ts";
import { ItemSchema } from "./item-schema.ts";

const item = {
  id: "lamp",
  name: "Table lamp",
  model: { kind: "asset", assetId: "lamp-asset" },
  placement: {
    kind: "floor",
    xM: 0,
    zM: 0,
    elevationM: 0.7,
    rotationRad: 0,
  },
  sizeM: { width: 0.3, height: 0.5, depth: 0.3 },
  locked: false,
};
const light = {
  on: true,
  emitter: { x: 0.5, y: 0.85, z: 0.5 },
  lumens: 400,
  temperatureK: 2700,
};

describe("item light", () => {
  test("a saved project without lights parses unchanged", () => {
    const project = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../../scripts/a15/project.json"),
        "utf8",
      ),
    );
    expect(ProjectSchema.parse(project)).toStrictEqual(project);
  });

  test("an item without a light parses unchanged", () => {
    expect(ItemSchema.parse(item)).toStrictEqual(item);
  });

  test("an item with a light parses unchanged", () => {
    expect(ItemSchema.parse({ ...item, light })).toStrictEqual({
      ...item,
      light,
    });
  });

  test("a light with a beam and a translucent shade parses unchanged", () => {
    const withBeam = {
      ...light,
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
      shade: "translucent",
    };
    expect(ItemSchema.parse({ ...item, light: withBeam })).toStrictEqual({
      ...item,
      light: withBeam,
    });
  });

  test.each([
    [
      "a beam direction that is not a unit vector",
      { beam: { direction: { x: 0, y: -0.5, z: 0 }, angleDeg: 90 } },
    ],
    [
      "a beam angle above 170°",
      { beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 180 } },
    ],
    ["an unknown shade", { shade: "glass" }],
    ["an emitter outside the box", { emitter: { x: 1.2, y: 0.5, z: 0.5 } }],
    ["zero lumens", { lumens: 0 }],
    ["too many lumens", { lumens: 1_000_000 }],
    ["a temperature below 1500 K", { temperatureK: 1000 }],
    ["a temperature above 8000 K", { temperatureK: 9000 }],
    ["renderer intensity", { intensity: 3 }],
  ])("rejects %s", (_name, change) => {
    expect(
      ItemSchema.safeParse({ ...item, light: { ...light, ...change } }).success,
    ).toBe(false);
  });
});
