import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { hasRoomBoundsChanged } from "./has-room-bounds-changed.ts";
import { isRoomCameraInvalid } from "./is-room-camera-invalid.ts";

const scene = createRectangularScene({
  widthM: 4,
  depthM: 6,
  ceilingHeightM: 2.6,
});

for (const widthM of [4.2, 2.8]) {
  test(`an exact 20% resize from 3.5 m to ${widthM} m keeps the camera`, () => {
    const previous = createRectangularScene({
      widthM: 3.5,
      depthM: 3.5,
      ceilingHeightM: 2.6,
    }).room;
    const current = createRectangularScene({
      widthM,
      depthM: widthM,
      ceilingHeightM: 2.6,
    }).room;
    expect(hasRoomBoundsChanged({ previous, current })).toBe(false);
  });
}

for (const example of [
  { widthM: 4, depthM: 6, offsetX: 0.5, offsetZ: 0, expected: false },
  { widthM: 4, depthM: 6, offsetX: 0.51, offsetZ: 0, expected: true },
  { widthM: 4, depthM: 6, offsetX: 0.4, offsetZ: 0.4, expected: true },
  { widthM: 4.8, depthM: 6, offsetX: 0, offsetZ: 0, expected: false },
  { widthM: 4.81, depthM: 6, offsetX: 0, offsetZ: 0, expected: true },
  { widthM: 4, depthM: 4.79, offsetX: 0, offsetZ: 0, expected: true },
  { widthM: 4.1, depthM: 6.1, offsetX: 0, offsetZ: 0, expected: false },
]) {
  test(`footprint threshold ${JSON.stringify(example)}`, () => {
    const room = createRectangularScene({ ...example, ceilingHeightM: 3 }).room;
    room.walls = room.walls.map((wall) => ({
      ...wall,
      startM: {
        x: wall.startM.x + example.offsetX,
        z: wall.startM.z + example.offsetZ,
      },
    }));
    expect(hasRoomBoundsChanged({ previous: scene.room, current: room })).toBe(
      example.expected,
    );
  });
}

test("camera validation uses the footprint polygon and permits inside views", () => {
  const room = {
    ...scene.room,
    walls: [
      { id: "a", kind: "solid", startM: { x: 0, z: 0 } },
      { id: "b", kind: "solid", startM: { x: 0, z: 4 } },
      { id: "c", kind: "solid", startM: { x: 2, z: 4 } },
      { id: "d", kind: "solid", startM: { x: 2, z: 2 } },
      { id: "e", kind: "solid", startM: { x: 4, z: 2 } },
      { id: "f", kind: "solid", startM: { x: 4, z: 0 } },
    ],
  } satisfies typeof scene.room;
  expect(
    isRoomCameraInvalid({
      room,
      camera: {
        positionM: { x: 6, y: 5, z: 6 },
        targetM: { x: 3, y: 1, z: 3 },
      },
    }),
  ).toBe(true);
  expect(
    isRoomCameraInvalid({
      room,
      camera: {
        positionM: { x: 1, y: 1, z: 1 },
        targetM: { x: 1, y: 1, z: 2 },
      },
    }),
  ).toBe(false);
  expect(
    isRoomCameraInvalid({
      room,
      camera: {
        positionM: { x: 1, y: 4, z: 1 },
        targetM: { x: 1, y: 1, z: 2 },
      },
    }),
  ).toBe(false);
  expect(
    isRoomCameraInvalid({
      room,
      camera: {
        positionM: { x: 6, y: 4, z: 6 },
        targetM: { x: 1, y: 1, z: 2 },
      },
    }),
  ).toBe(false);
});

for (const y of [-0.01, -2]) {
  test(`camera below floor at ${y} m is invalid`, () => {
    expect(
      isRoomCameraInvalid({
        room: scene.room,
        camera: { positionM: { x: 0, y, z: 0 }, targetM: { x: 0, y: 1, z: 0 } },
      }),
    ).toBe(true);
  });
}
