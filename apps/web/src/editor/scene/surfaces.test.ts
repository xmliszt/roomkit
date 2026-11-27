import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { Matrix4, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { createSurfaceGeometry } from "./create-surface-geometry.ts";
import { createSurfaceMaterial } from "./create-surface-material.ts";
import { getWallSurfaceTransform } from "./get-wall-surface-transform.ts";
import { isCeilingVisible } from "./is-ceiling-visible.ts";

const room = createRectangularScene({
  widthM: 4.8,
  depthM: 4,
  ceilingHeightM: 2.6,
}).room;

describe("surface coordinates and ceiling visibility", () => {
  it("uses metres along X/Z for floor and from wall start to end for walls", () => {
    const floor = createSurfaceGeometry({ kind: "floor", walls: room.walls });
    const wall = createSurfaceGeometry({
      kind: "wall",
      lengthM: 4.8,
      heightM: 2.6,
    });
    const positions = floor.getAttribute("position");
    const uv = floor.getAttribute("uv");
    for (let index = 0; index < positions.count; index++) {
      expect(uv.getX(index)).toBeCloseTo(positions.getX(index));
      expect(uv.getY(index)).toBeCloseTo(positions.getZ(index));
    }

    floor.dispose();
    wall.dispose();
  });
  it("maps world wall starts to U=0 and ends to U=length after the render transform", () => {
    for (const segment of getWallSegments(room)) {
      const geometry = createSurfaceGeometry({
        kind: "wall",
        lengthM: segment.lengthM,
        heightM: room.ceilingHeightM,
      });
      const transform = getWallSurfaceTransform({
        segment,
        heightM: room.ceilingHeightM,
      });
      const matrix = new Matrix4()
        .makeRotationY(transform.rotationY)
        .setPosition(...transform.position);
      const positions = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      for (let index = 0; index < positions.count; index++) {
        const point = new Vector3()
          .fromBufferAttribute(positions, index)
          .applyMatrix4(matrix);
        const u = uv.getX(index);
        const endpoint = Math.abs(u) < 1e-6 ? segment.startM : segment.endM;
        expect(point.x).toBeCloseTo(endpoint.x);
        expect(point.z).toBeCloseTo(endpoint.z);
        expect(u).toBeCloseTo(
          endpoint === segment.startM ? 0 : segment.lengthM,
        );
        expect(uv.getY(index)).toBeCloseTo(point.y);
      }
      geometry.dispose();
    }
  });
  it("hides the ceiling from above and shows it from below, inside or outside the room", () => {
    expect(isCeilingVisible({ room, cameraM: { x: 0, y: 5, z: 0 } })).toBe(
      false,
    );
    expect(isCeilingVisible({ room, cameraM: { x: 0, y: 1.6, z: 0 } })).toBe(
      true,
    );
    expect(isCeilingVisible({ room, cameraM: { x: 5, y: 2.2, z: 6 } })).toBe(
      true,
    );
  });
  it("maps paint finish to roughness without losing the colour", () => {
    const environment = new Texture();
    const finishes = (["matte", "eggshell", "satin"] as const).map(
      (finish) =>
        createSurfaceMaterial({
          material: { kind: "paint", color: "#9caf91", finish },
          color: "#9caf91",
          environment,
        }).material,
    );
    expect(finishes.map((material) => material.roughness)).toEqual([
      0.95, 0.65, 0.35,
    ]);
    expect(finishes.map((material) => material.color.getHexString())).toEqual([
      "9caf91",
      "9caf91",
      "9caf91",
    ]);
    for (const material of finishes) material.dispose();
    environment.dispose();
  });
});
