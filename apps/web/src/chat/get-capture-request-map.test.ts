import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { getCaptureRequestMap } from "./get-capture-request-map.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 6,
  ceilingHeightM: 2.6,
}).room;

test("a floor request with the same standing and target point has no direction arrow", () => {
  const map = getCaptureRequestMap({
    room,
    block: {
      kind: "capture-request",
      wallId: "floor",
      standM: { x: 1, z: 1 },
      lookAtM: { x: 1, z: 1 },
      text: "Look down at the floor",
    },
  });
  expect(map.arrowPoints).toBeUndefined();
  expect(map.floorPoints).toBe("-2,-3 -2,3 2,3 2,-3");
});

test("keeps a standing point outside the room visible and aims the arrow at its target", () => {
  const map = getCaptureRequestMap({
    room,
    block: {
      kind: "capture-request",
      wallId: "wall-1",
      standM: { x: -5, z: 0 },
      lookAtM: { x: -2, z: 0 },
      text: "Face the wall",
    },
  });
  const [left, top, width, height] = map.viewBox.split(" ").map(Number);
  expect(left).toBeLessThan(-5);
  expect(top).toBeLessThan(-3);
  expect((left ?? 0) + (width ?? 0)).toBeGreaterThan(2);
  expect((top ?? 0) + (height ?? 0)).toBeGreaterThan(3);
  expect(map.arrowPoints?.split(" ").at(0)).toBe("-2,0");
});
