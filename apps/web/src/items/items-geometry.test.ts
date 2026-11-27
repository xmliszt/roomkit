import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { describe, expect, it } from "vitest";
import { getWallSegments } from "../room/get-wall-segments.ts";
import { getCatalogWallPlacement } from "./get-catalog-wall-placement.ts";
import { getDraggedPlacement } from "./get-dragged-placement.ts";
import { getDuplicatePlacement } from "./get-duplicate-placement.ts";
import { getGrabOffset } from "./get-grab-offset.ts";
import { getItemBox } from "./get-item-box.ts";
import { getItemDimensionLines } from "./get-item-dimension-lines.ts";
import { getItemFrame } from "./get-item-frame.ts";
import { getRayPlaneHit } from "./get-ray-plane-hit.ts";
import { getRingAngle } from "./get-ring-angle.ts";
import { getTurnedRotation } from "./get-turned-rotation.ts";
import { getWallHits } from "./get-wall-hits.ts";
import { snapToGrid } from "./snap-to-grid.ts";

const room = createRectangularScene({
  widthM: 4,
  depthM: 3,
  ceilingHeightM: 2.5,
}).room;
const segments = getWallSegments(room);
const size = { width: 0.4, height: 0.2, depth: 0.1 };

describe("getItemFrame", () => {
  it("puts a wall item's anchor on the wall, facing into the room", () => {
    const frame = getItemFrame({
      placement: {
        kind: "wall",
        wallId: "wall-1",
        alongM: 1,
        heightM: 0.3,
        rotationRad: 0.2,
      },
      segments,
      ceilingHeightM: room.ceilingHeightM,
    });
    expect(frame?.positionM).toEqual({ x: -2, y: 0.3, z: -0.5 });
    expect(Math.sin(frame?.yawRad ?? 0)).toBeCloseTo(1);
    expect(Math.cos(frame?.yawRad ?? 1)).toBeCloseTo(0);
    expect(frame?.rollRad).toBe(0.2);
  });

  it("puts floor items at their elevation and ceiling items at the ceiling", () => {
    expect(
      getItemFrame({
        placement: {
          kind: "floor",
          xM: 1,
          zM: -1,
          elevationM: 0.4,
          rotationRad: 1,
        },
        segments,
        ceilingHeightM: 2.5,
      }),
    ).toEqual({ positionM: { x: 1, y: 0.4, z: -1 }, yawRad: 1, rollRad: 0 });
    expect(
      getItemFrame({
        placement: { kind: "ceiling", xM: 0, zM: 0, rotationRad: 0 },
        segments,
        ceilingHeightM: 2.5,
      })?.positionM.y,
    ).toBe(2.5);
  });

  it("returns undefined for a wall that is not in the room", () => {
    expect(
      getItemFrame({
        placement: {
          kind: "wall",
          wallId: "gone",
          alongM: 0,
          heightM: 0,
          rotationRad: 0,
        },
        segments,
        ceilingHeightM: 2.5,
      }),
    ).toBeUndefined();
  });
});

describe("getItemBox", () => {
  it("measures from the anchor each mount uses", () => {
    expect(getItemBox({ placementKind: "floor", sizeM: size }).y).toEqual({
      min: 0,
      max: 0.2,
    });
    expect(getItemBox({ placementKind: "wall", sizeM: size }).z).toEqual({
      min: 0,
      max: 0.1,
    });
    expect(getItemBox({ placementKind: "ceiling", sizeM: size }).y).toEqual({
      min: -0.2,
      max: 0,
    });
  });
});

describe("snapToGrid", () => {
  it("rounds to 0.05 m without float noise", () => {
    expect(snapToGrid(1.537)).toBe(1.55);
    expect(snapToGrid(-0.024)).toBe(-0);
    expect(snapToGrid(0.3)).toBe(0.3);
  });
});

describe("ray hits", () => {
  const ray = {
    originM: { x: 0, y: 1, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
  };

  it("meets a plane ahead and misses one behind", () => {
    expect(
      getRayPlaneHit({
        ray,
        pointM: { x: -2, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
      }),
    ).toEqual({ x: -2, y: 1, z: 0 });
    expect(
      getRayPlaneHit({
        ray,
        pointM: { x: 2, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
      }),
    ).toBeUndefined();
  });

  it("returns wall hits nearest first, in wall-local numbers", () => {
    const hits = getWallHits({ ray, segments, ceilingHeightM: 2.5 });
    expect(hits.at(0)).toEqual({
      wallId: "wall-1",
      alongM: 1.5,
      heightM: 1,
      distanceM: 2,
      isOnWall: true,
    });
  });
});

describe("dragging", () => {
  const wallPlacement = {
    kind: "wall" as const,
    wallId: "wall-1",
    alongM: 1,
    heightM: 0.3,
    rotationRad: 0,
  };

  it("keeps the grab offset, snaps, and can change wall", () => {
    const offset = getGrabOffset({
      placement: wallPlacement,
      hit: { kind: "wall", wallId: "wall-1", alongM: 1.02, heightM: 0.31 },
    });
    expect(offset).toBeDefined();
    if (offset === undefined) return;
    expect(
      getDraggedPlacement({
        placement: wallPlacement,
        hit: { kind: "wall", wallId: "wall-4", alongM: 1.5, heightM: 0.5 },
        offset,
        isSnapping: true,
      }),
    ).toEqual({
      ...wallPlacement,
      wallId: "wall-4",
      alongM: 1.5,
      heightM: 0.5,
    });
    expect(
      getDraggedPlacement({
        placement: wallPlacement,
        hit: { kind: "wall", wallId: "wall-1", alongM: 1.5, heightM: 0.5 },
        offset,
        isSnapping: false,
      }),
    ).toMatchObject({ alongM: expect.closeTo(1.48) });
  });

  it("never puts a wall item below the floor", () => {
    expect(
      getDraggedPlacement({
        placement: wallPlacement,
        hit: { kind: "wall", wallId: "wall-1", alongM: 1, heightM: -0.4 },
        offset: { firstM: 0, secondM: 0 },
        isSnapping: true,
      }),
    ).toMatchObject({ heightM: 0 });
  });

  it("moves floor items on the floor and refuses a wall hit", () => {
    const floor = {
      kind: "floor" as const,
      xM: 0,
      zM: 0,
      elevationM: 0.2,
      rotationRad: 1,
    };
    expect(
      getDraggedPlacement({
        placement: floor,
        hit: { kind: "horizontal", xM: 0.73, zM: -1.12 },
        offset: { firstM: 0, secondM: 0 },
        isSnapping: true,
      }),
    ).toEqual({ ...floor, xM: 0.75, zM: -1.1 });
    expect(
      getDraggedPlacement({
        placement: floor,
        hit: { kind: "wall", wallId: "wall-1", alongM: 1, heightM: 1 },
        offset: { firstM: 0, secondM: 0 },
        isSnapping: true,
      }),
    ).toBeUndefined();
  });
});

describe("rotating", () => {
  it("measures floor angles the way rotationRad turns about +Y", () => {
    const angle = getRingAngle({
      placementKind: "floor",
      anchorM: { x: 0, y: 0, z: 0 },
      yawRad: 0,
      pointM: { x: Math.cos(0.3), y: 0, z: -Math.sin(0.3) },
    });
    expect(angle).toBeCloseTo(0.3);
  });

  it("measures wall angles in the wall plane", () => {
    const yawRad = Math.PI / 2;
    expect(
      getRingAngle({
        placementKind: "wall",
        anchorM: { x: -2, y: 1, z: 0 },
        yawRad,
        pointM: { x: -2, y: 2, z: 0 },
      }),
    ).toBeCloseTo(Math.PI / 2);
  });

  it("snaps the turn to 15° steps and wraps it", () => {
    expect(
      getTurnedRotation({
        startRad: 0,
        startAngleRad: 0.1,
        angleRad: 0.1 + 0.35,
        isSnapping: true,
      }),
    ).toBeCloseTo(Math.PI / 12);
    expect(
      getTurnedRotation({
        startRad: 0,
        startAngleRad: 0,
        angleRad: 0.35,
        isSnapping: false,
      }),
    ).toBeCloseTo(0.35);
    expect(
      getTurnedRotation({
        startRad: 3,
        startAngleRad: 0,
        angleRad: 1,
        isSnapping: false,
      }),
    ).toBeCloseTo(4 - 2 * Math.PI);
  });
});

describe("getCatalogWallPlacement", () => {
  it("picks the wall nearest the focus and keeps the item inside its ends", () => {
    expect(
      getCatalogWallPlacement({
        segments,
        focusM: { x: -1.9, z: 1.2 },
        widthM: 0.086,
        heightM: 0.3,
      }),
    ).toEqual({
      kind: "wall",
      wallId: "wall-1",
      alongM: 2.7,
      heightM: 0.3,
      rotationRad: 0,
    });
    expect(
      getCatalogWallPlacement({
        segments: segments.slice(0, 1),
        focusM: { x: -1.9, z: 5 },
        widthM: 0.2,
        heightM: 0.3,
      })?.alongM,
    ).toBe(2.9);
    expect(
      getCatalogWallPlacement({
        segments: [],
        focusM: { x: 0, z: 0 },
        widthM: 0.1,
        heightM: 0.3,
      }),
    ).toBeUndefined();
  });
});

describe("getDuplicatePlacement", () => {
  it("shifts by the width plus a gap along the item's width axis", () => {
    const placement = getDuplicatePlacement({
      placement: {
        kind: "floor",
        xM: 0,
        zM: 0,
        elevationM: 0,
        rotationRad: Math.PI / 2,
      },
      sizeM: size,
      room,
    });
    expect(placement.kind === "floor" && placement.xM).toBeCloseTo(0);
    expect(placement.kind === "floor" && placement.zM).toBeCloseTo(-0.5);
  });
});

describe("getDuplicatePlacement at the edges", () => {
  it("goes the other way past a wall end or outside the room", () => {
    expect(
      getDuplicatePlacement({
        placement: {
          kind: "wall",
          wallId: "wall-1",
          alongM: 2.9,
          heightM: 0.3,
          rotationRad: 0,
        },
        sizeM: size,
        room,
      }),
    ).toMatchObject({ alongM: 2.4 });
    expect(
      getDuplicatePlacement({
        placement: {
          kind: "floor",
          xM: 1.8,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: size,
        room,
      }),
    ).toMatchObject({ xM: 1.3 });
    expect(
      getDuplicatePlacement({
        placement: {
          kind: "floor",
          xM: 1.4,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: size,
        room,
      }),
    ).toMatchObject({ xM: expect.closeTo(0.9) });
    expect(
      getDuplicatePlacement({
        placement: {
          kind: "wall",
          wallId: "wall-1",
          alongM: 0.3,
          heightM: 0.3,
          rotationRad: 0,
        },
        sizeM: size,
        room,
      }),
    ).toMatchObject({ alongM: expect.closeTo(0.8) });
  });
});

describe("getItemDimensionLines", () => {
  it("labels width, height and depth", () => {
    expect(
      getItemDimensionLines({ placementKind: "wall", sizeM: size }).map(
        (line) => line.text,
      ),
    ).toEqual(["0.40 m", "0.20 m", "0.10 m"]);
  });
});
