import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { describe, expect, it } from "vitest";
import { getLibraryPlacement } from "./get-library-placement.ts";

const scene = createRectangularScene({
  widthM: 6,
  depthM: 5,
  ceilingHeightM: 2.6,
});
const camera = {
  positionM: { x: 1, y: 6, z: 6 },
  targetM: { x: 1, y: 0, z: 0.5 },
};

describe("getLibraryPlacement", () => {
  it("puts a floor model on the floor at the view centre", () => {
    expect(
      getLibraryPlacement({
        model: {
          assetId: "chair",
          mount: "floor",
          sizeM: { width: 1, height: 1, depth: 1 },
        },
        camera,
        room: scene.room,
      }),
    ).toEqual({
      kind: "floor",
      xM: 1,
      zM: 0.5,
      elevationM: 0,
      rotationRad: 0,
    });
  });

  it("puts a charging port on the nearest visible wall at its default height", () => {
    expect(
      getLibraryPlacement({
        model: {
          assetId: "charging-port",
          mount: "wall",
          sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
        },
        camera,
        room: scene.room,
      }),
    ).toEqual({
      kind: "wall",
      wallId: "wall-3",
      alongM: 2,
      heightM: 0.3,
      rotationRad: 0,
    });
  });

  it("centres another wall model 1.5 m up, below the ceiling and above the floor", () => {
    const model = {
      assetId: "mirror",
      mount: "wall" as const,
      sizeM: { width: 0.9, height: 0.6, depth: 0.05 },
    };
    expect(
      getLibraryPlacement({ model, camera, room: scene.room }),
    ).toMatchObject({ kind: "wall", heightM: 1.5 });
    expect(
      getLibraryPlacement({
        model: { ...model, sizeM: { ...model.sizeM, height: 2.4 } },
        camera,
        room: scene.room,
      }),
    ).toMatchObject({ kind: "wall", heightM: expect.closeTo(1.4) });
    expect(
      getLibraryPlacement({
        model: { ...model, sizeM: { ...model.sizeM, height: 3 } },
        camera,
        room: scene.room,
      }),
    ).toMatchObject({ kind: "wall", heightM: 1.5 });
  });

  it("puts a ceiling model on the ceiling at the view centre", () => {
    expect(
      getLibraryPlacement({
        model: {
          assetId: "lamp",
          mount: "ceiling",
          sizeM: { width: 0.4, height: 0.3, depth: 0.4 },
        },
        camera,
        room: scene.room,
      }),
    ).toEqual({ kind: "ceiling", xM: 1, zM: 0.5, rotationRad: 0 });
  });
  it("falls back to the camera target, then the room centre, when the view centre is outside the room", () => {
    const model = {
      assetId: "chair",
      mount: "floor" as const,
      sizeM: { width: 1, height: 1, depth: 1 },
    };
    expect(
      getLibraryPlacement({ model, camera: scene.camera, room: scene.room }),
    ).toMatchObject({ kind: "floor", xM: 0, zM: 0 });
    expect(
      getLibraryPlacement({
        model,
        camera: {
          positionM: { x: 7, y: 2, z: 6 },
          targetM: { x: 1, y: 1.3, z: 0.5 },
        },
        room: scene.room,
      }),
    ).toMatchObject({ kind: "floor", xM: 1, zM: 0.5 });
    expect(
      getLibraryPlacement({
        model,
        camera: {
          positionM: { x: 0, y: 1, z: 20 },
          targetM: { x: 0, y: 1.5, z: 10 },
        },
        room: scene.room,
      }),
    ).toMatchObject({ kind: "floor", xM: 0, zM: 0 });
  });
});
