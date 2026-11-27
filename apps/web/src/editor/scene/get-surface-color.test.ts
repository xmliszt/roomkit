import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { getSurfaceColor } from "./get-surface-color.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 4,
  ceilingHeightM: 2.5,
}).room;

test("a stored surface colour wins over the default", () => {
  const painted = { ...room, surfaces: { "wall-2": { color: "#336699" } } };
  expect(getSurfaceColor({ room: painted, surfaceId: "wall-2" })).toBe(
    "#336699",
  );
  expect(getSurfaceColor({ room: painted, surfaceId: "wall-1" })).toBe(
    "#FCFBF9",
  );
  expect(getSurfaceColor({ room, surfaceId: "floor" })).toBe("#F7F5EF");
  expect(getSurfaceColor({ room, surfaceId: "ceiling" })).toBe("#FCFBF9");
});
