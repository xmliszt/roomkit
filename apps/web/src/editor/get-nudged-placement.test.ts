import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import { describe, expect, it } from "vitest";
import { getNudgedPlacement } from "./get-nudged-placement.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 4,
  ceilingHeightM: 2.6,
}).room;
const placement = {
  kind: "floor",
  xM: 0,
  zM: 0,
  elevationM: 0.3,
  rotationRad: 0.2,
} satisfies Placement;
const input = {
  widthM: 0.5,
  placement,
  room,
  right: { x: 1, y: 0, z: 0 },
  horizontal: 1,
  vertical: 0,
  stepM: 0.05,
  isSnapping: true,
};

describe("getNudgedPlacement", () => {
  it("moves a grid step along the screen's horizontal floor direction", () => {
    expect(getNudgedPlacement(input)).toEqual({ ...placement, xM: 0.05 });
    expect(getNudgedPlacement({ ...input, stepM: 0.5 })).toEqual({
      ...placement,
      xM: 0.5,
    });
    expect(
      getNudgedPlacement({ ...input, right: { x: 0, y: 0, z: 1 } }),
    ).toEqual({ ...placement, zM: 0.05 });
  });
  it("uses one whole world-axis step when snapping at a 45 degree view", () => {
    const result = getNudgedPlacement({
      ...input,
      right: { x: 1, y: 0, z: -1 },
    });
    expect(result).toEqual({ ...placement, xM: 0.05 });
  });
  it("keeps wall nudges inside the wall by half the item width", () => {
    const wall = {
      kind: "wall",
      wallId: "wall-4",
      alongM: 0.26,
      heightM: 0.33,
      rotationRad: 0,
    } satisfies Placement;
    expect(getNudgedPlacement({ ...input, placement: wall })).toEqual({
      ...wall,
      alongM: 0.25,
    });
    expect(
      getNudgedPlacement({
        ...input,
        placement: { ...wall, alongM: 3.74 },
        horizontal: -1,
      }),
    ).toEqual({ ...wall, alongM: 3.75 });
    expect(
      getNudgedPlacement({
        ...input,
        placement: wall,
        right: { x: 1, y: 0, z: -1 },
        horizontal: -1,
      }),
    ).toEqual({ ...wall, alongM: 0.31 });
  });
  it("preserves a 0.05 m diagonal distance without snapping", () => {
    const result = getNudgedPlacement({
      ...input,
      right: { x: 1, y: 0, z: -1 },
      isSnapping: false,
    });
    expect(result.kind).toBe("floor");
    if (result.kind !== "floor") throw new Error("floor placement required");
    expect(Math.hypot(result.xM, result.zM)).toBeCloseTo(0.05);
    expect(result.elevationM).toBe(placement.elevationM);
  });
  it("keeps wall items mounted at their height and ceiling items on the ceiling", () => {
    const wall = {
      kind: "wall",
      wallId: "wall-4",
      alongM: 1,
      heightM: 0.33,
      rotationRad: 0,
    } satisfies Placement;
    expect(getNudgedPlacement({ ...input, placement: wall })).toEqual({
      ...wall,
      alongM: 0.95,
    });
    const ceiling = {
      kind: "ceiling",
      xM: 0,
      zM: 0,
      rotationRad: 0,
    } satisfies Placement;
    expect(getNudgedPlacement({ ...input, placement: ceiling })).toEqual({
      ...ceiling,
      xM: 0.05,
    });
  });
});
