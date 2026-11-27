import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { expect, test } from "vitest";
import { formatRoomSize } from "./format-room-size.ts";
import { getDimensionLine } from "./get-dimension-line.ts";
import { getFloorDots } from "./get-floor-dots.ts";
import { getResizedWalls } from "./get-resized-walls.ts";
import { getWallSegments } from "./get-wall-segments.ts";
import { getWallVisibility } from "./get-wall-visibility.ts";
import { isGeneratedCamera } from "./is-generated-camera.ts";
import { isWallHidden } from "./is-wall-hidden.ts";

const scene = createRectangularScene({
  widthM: 3.0,
  depthM: 5.2,
  ceilingHeightM: 2.7,
});
const room = scene.room;

const lShapedRoom = {
  ...room,
  walls: [
    { id: "a", startM: { x: 0, z: 0 }, kind: "solid" },
    { id: "b", startM: { x: 0, z: 4 }, kind: "solid" },
    { id: "c", startM: { x: 4, z: 4 }, kind: "solid" },
    { id: "d", startM: { x: 4, z: 2 }, kind: "solid" },
    { id: "e", startM: { x: 2, z: 2 }, kind: "solid" },
    { id: "f", startM: { x: 2, z: 0 }, kind: "open" },
  ],
} satisfies Room;

test("wall segments point their outward normal away from the room centre", () => {
  const segments = getWallSegments(room);
  expect(segments.map((segment) => segment.wall.id)).toEqual([
    "wall-1",
    "wall-2",
    "wall-3",
    "wall-4",
  ]);
  expect(
    segments.map((segment) => [segment.outward.x + 0, segment.outward.z + 0]),
  ).toEqual([
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ]);
  expect(segments.map((segment) => segment.lengthM)).toEqual([
    5.2, 3.0, 5.2, 3.0,
  ]);
});

test("a camera outside a corner hides the two walls nearest to it", () => {
  const hidden = getWallSegments(room)
    .filter((segment) => isWallHidden({ segment, cameraM: { x: 5, z: 6 } }))
    .map((segment) => segment.wall.id);
  expect(hidden).toEqual(["wall-2", "wall-3"]);
  expect(
    getWallSegments(room).some((segment) =>
      isWallHidden({ segment, cameraM: { x: 0, z: 0 } }),
    ),
  ).toBe(false);
});

test("the top strip reads width × depth × height", () => {
  expect(formatRoomSize({ room })).toBe("3.00 × 5.20 × 2.70 m");
});

test("floor dots sit on a 0.5 m grid inside the walls", () => {
  const dots = getFloorDots({
    room,
    spacingM: 0.5,
    marginM: 0.1,
    maxDots: 1000,
  });
  expect(dots).toHaveLength(5 * 11);
  expect(
    dots.every((dot) => Math.abs(dot.x) < 1.5 && Math.abs(dot.z) < 2.6),
  ).toBe(true);
  expect(dots).toContainEqual({ x: 0, z: 0 });
  expect(dots).not.toContainEqual({ x: -1.5, z: 0 });
});

test("a dimension line runs outside the wall with 45° ticks and the wall length", () => {
  const segment = getWallSegments(room).at(1);
  if (segment === undefined) throw new Error("wall-2 missing");
  const line = getDimensionLine({ segment });
  expect(line.text).toBe("3.00 m");
  expect(line.labelM.x).toBeCloseTo(0);
  expect(line.labelM.z).toBeCloseTo(2.88);
  const [measure, startTick] = line.segments;
  expect(measure?.[0].x).toBeCloseTo(-1.5);
  expect(measure?.[1].x).toBeCloseTo(1.5);
  expect(measure?.[1].z).toBeCloseTo(2.88);
  const [a, b] = startTick ?? [];
  expect(Math.abs((b?.x ?? 0) - (a?.x ?? 0))).toBeCloseTo(
    Math.abs((b?.z ?? 0) - (a?.z ?? 0)),
  );
});

test("floor dots follow an L-shaped floor and stop at the cap", () => {
  const dots = getFloorDots({
    room: lShapedRoom,
    spacingM: 0.5,
    marginM: 0.1,
    maxDots: 1000,
  });
  expect(dots).toContainEqual({ x: 1, z: 1 });
  expect(dots).toContainEqual({ x: 3, z: 3 });
  expect(dots).not.toContainEqual({ x: 3, z: 1 });
  expect(
    getFloorDots({
      room: lShapedRoom,
      spacingM: 0.5,
      marginM: 0.1,
      maxDots: 10,
    }),
  ).toEqual([]);
  const hugeRoom = createRectangularScene({
    widthM: 1e10,
    depthM: 3,
    ceilingHeightM: 2.7,
  }).room;
  expect(
    getFloorDots({
      room: hugeRoom,
      spacingM: 0.5,
      marginM: 0.1,
      maxDots: 20_000,
    }),
  ).toEqual([]);
});

test("an open wall is never drawn but keeps its corners when a neighbour is drawn", () => {
  const segments = getWallSegments(lShapedRoom);
  const visibility = getWallVisibility({ segments, cameraM: { x: 1, z: 3 } });
  expect(visibility.hidden.every((isHidden) => !isHidden)).toBe(true);
  expect(visibility.drawn).toEqual([true, true, true, true, true, false]);
  expect(visibility.cornerDrawn).toEqual([true, true, true, true, true, true]);
  const outside = getWallVisibility({ segments, cameraM: { x: 6, z: -3 } });
  expect(outside.drawn.at(5)).toBe(false);
});

test("only the camera createRectangularScene made counts as generated", () => {
  expect(isGeneratedCamera({ room, camera: scene.camera })).toBe(true);
  expect(
    isGeneratedCamera({
      room,
      camera: { ...scene.camera, targetM: { x: 0, y: 1, z: 0 } },
    }),
  ).toBe(false);
});

test("resizing stretches the walls about the room centre and keeps ids and kinds", () => {
  const walls = getResizedWalls({ room, widthM: 4.1, depthM: 5.2 });
  expect(walls.map((wall) => wall.id)).toEqual(
    room.walls.map((wall) => wall.id),
  );
  expect(walls.map((wall) => [wall.startM.x, wall.startM.z])).toEqual([
    [-2.05, -2.6],
    [-2.05, 2.6],
    [2.05, 2.6],
    [2.05, -2.6],
  ]);
  const lWalls = getResizedWalls({ room: lShapedRoom, widthM: 8, depthM: 2 });
  expect(
    lWalls.map((wall) => [wall.startM.x, wall.startM.z, wall.kind]),
  ).toEqual([
    [-2, 1, "solid"],
    [-2, 3, "solid"],
    [6, 3, "solid"],
    [6, 2, "solid"],
    [2, 2, "solid"],
    [2, 1, "open"],
  ]);
});

test("resizing one axis leaves the other axis's coordinates exact", () => {
  const offCentre = {
    ...room,
    walls: [
      { id: "a", startM: { x: 0.1, z: -1.7 }, kind: "solid" },
      { id: "b", startM: { x: 0.1, z: 0.3 }, kind: "solid" },
      { id: "c", startM: { x: 2.3, z: 0.3 }, kind: "solid" },
    ],
  } satisfies Room;
  const walls = getResizedWalls({ room: offCentre, widthM: 3, depthM: 2 });
  expect(walls.map((wall) => wall.startM.z)).toEqual([-1.7, 0.3, 0.3]);
});
