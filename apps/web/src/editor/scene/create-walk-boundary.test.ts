import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { describe, expect, it } from "vitest";
import { isInsidePolygon } from "../../room/is-inside-polygon.ts";
import { createWalkBoundary } from "./create-walk-boundary.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 4,
  ceilingHeightM: 2.6,
}).room;

describe("walk boundary", () => {
  it("uses an inside target and falls back to the centre for an outside target", () => {
    const boundary = createWalkBoundary(room);
    expect(boundary.start({ x: 1, z: -1 })).toEqual({ x: 1, z: -1 });
    expect(boundary.start({ x: 10, z: 10 })).toEqual({ x: 0, z: 0 });
  });
  it("pushes a start point near a wall inward instead of to the centre", () => {
    const boundary = createWalkBoundary(room);
    const nearWall = boundary.start({ x: 1.95, z: 0.5 });
    expect(nearWall.z).toBeCloseTo(0.5);
    expect(nearWall.x).toBeCloseTo(2 - 0.121);
    const nearCorner = boundary.start({ x: 1.96, z: -1.97 });
    expect(nearCorner.x).toBeLessThanOrEqual(2 - 0.12);
    expect(nearCorner.z).toBeGreaterThanOrEqual(-2 + 0.12);
    expect(Math.hypot(nearCorner.x, nearCorner.z)).toBeGreaterThan(2.5);
    expect(boundary.start({ x: 2.5, z: 0.5 })).toEqual({ x: 0, z: 0 });
  });
  it("stops at all four walls even with a large movement", () => {
    const boundary = createWalkBoundary(room);
    for (const direction of [
      { xM: 20, zM: 0 },
      { xM: -20, zM: 0 },
      { xM: 0, zM: 20 },
      { xM: 0, zM: -20 },
    ]) {
      const next = boundary.move({ from: { x: 0, z: 0 }, ...direction });
      expect(Math.max(Math.abs(next.x), Math.abs(next.z))).toBeGreaterThan(1.8);
      expect(Math.max(Math.abs(next.x), Math.abs(next.z))).toBeLessThanOrEqual(
        1.88,
      );
    }
  });
  it("cannot cross the notch of a concave room to another interior point", () => {
    const polygon = [
      { x: 0, z: 0 },
      { x: 0, z: 4 },
      { x: 1, z: 4 },
      { x: 1, z: 1 },
      { x: 3, z: 1 },
      { x: 3, z: 4 },
      { x: 4, z: 4 },
      { x: 4, z: 0 },
    ];
    const boundary = createWalkBoundary({
      ...room,
      walls: polygon.map((startM, index) => ({
        id: `wall-${index}`,
        kind: "solid",
        startM,
      })),
    });
    expect(
      isInsidePolygon({ point: boundary.start({ x: 8, z: 8 }), polygon }),
    ).toBe(true);
    const next = boundary.move({ from: { x: 0.5, z: 3.5 }, xM: 3, zM: 0 });
    expect(isInsidePolygon({ point: next, polygon })).toBe(true);
    expect(next.x).toBeLessThan(1);
  });
});
