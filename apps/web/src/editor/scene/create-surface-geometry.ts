import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import {
  Float32BufferAttribute,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from "three";

export function createSurfaceGeometry(
  options:
    | { kind: "floor"; walls: Room["walls"] }
    | { kind: "wall"; lengthM: number; heightM: number },
) {
  const geometry =
    options.kind === "floor"
      ? new ShapeGeometry(
          new Shape(
            options.walls.map(
              (wall) => new Vector2(wall.startM.x, -wall.startM.z),
            ),
          ),
        ).rotateX(-Math.PI / 2)
      : new PlaneGeometry(options.lengthM, options.heightM);
  const positions = geometry.getAttribute("position");
  const uv = Array.from({ length: positions.count }, (_, index) =>
    options.kind === "floor"
      ? [positions.getX(index), positions.getZ(index)]
      : [
          options.lengthM / 2 - positions.getX(index),
          positions.getY(index) + options.heightM / 2,
        ],
  ).flat();
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
}
