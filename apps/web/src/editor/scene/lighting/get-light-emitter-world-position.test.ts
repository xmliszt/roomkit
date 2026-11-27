import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { expect, test } from "vitest";
import { getItemBox } from "../../../items/get-item-box.ts";
import { getWallSegments } from "../../../room/get-wall-segments.ts";
import { getItemRenderLayout } from "../get-item-render-layout.ts";
import { getLightEmitterWorldPosition } from "./get-light-emitter-world-position.ts";

test.each([false, true])(
  "emitter follows box size, rotation and mirroring (%s)",
  (mirrored) => {
    const matrixWorld = new Matrix4().compose(
      new Vector3(3, 2, -4),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0, "YXZ")),
      new Vector3(1, 1, 1),
    );
    const position = getLightEmitterWorldPosition({
      emitter: { x: 0.25, y: 0.75, z: 0.8 },
      box: getItemBox({
        placementKind: "floor",
        sizeM: { width: 2, height: 4, depth: 1 },
      }),
      mirrored,
      matrixWorld,
    });
    expect(position.x).toBeCloseTo(3.3);
    expect(position.y).toBeCloseTo(5);
    expect(position.z).toBeCloseTo(mirrored ? -4.5 : -3.5);
  },
);

test("wall rotation uses the same YXZ frame as the model", () => {
  const matrixWorld = new Matrix4().makeRotationFromEuler(
    new Euler(0, Math.PI / 2, Math.PI / 2, "YXZ"),
  );
  const position = getLightEmitterWorldPosition({
    emitter: { x: 1, y: 1, z: 1 },
    box: getItemBox({
      placementKind: "wall",
      sizeM: { width: 2, height: 4, depth: 1 },
    }),
    mirrored: false,
    matrixWorld,
  });
  expect(position.x).toBeCloseTo(1);
  expect(position.y).toBeCloseTo(1);
  expect(position.z).toBeCloseTo(2);
});

test("a wall opening's emitter uses the rendered thickness", () => {
  const room = createRectangularScene({
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  }).room;
  const item = {
    id: "opening",
    name: "Opening",
    model: { kind: "asset", assetId: "opening" },
    placement: {
      kind: "wall",
      wallId: "wall-1",
      alongM: 1.5,
      heightM: 1,
      rotationRad: 0,
    },
    sizeM: { width: 1, height: 2, depth: 0.4 },
    cutsOpening: true,
    locked: false,
  } satisfies Item;
  const layout = getItemRenderLayout({
    item,
    segments: getWallSegments(room),
    ceilingHeightM: room.ceilingHeightM,
  });
  if (!layout) throw new Error("Missing opening layout");
  const matrixWorld = new Matrix4().compose(
    new Vector3(
      layout.frame.positionM.x,
      layout.frame.positionM.y,
      layout.frame.positionM.z,
    ),
    new Quaternion().setFromEuler(
      new Euler(0, layout.frame.yawRad, layout.frame.rollRad, "YXZ"),
    ),
    new Vector3(1, 1, 1),
  );
  const position = getLightEmitterWorldPosition({
    emitter: { x: 0.5, y: 0.5, z: 0.7 },
    box: layout.box,
    mirrored: false,
    matrixWorld,
  });
  expect(position.x).toBeCloseTo(-2.036);
  expect(position.y).toBeCloseTo(1);
  expect(position.z).toBeCloseTo(-0.5);
});
