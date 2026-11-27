import { createRectangularScene } from "../scene/create-rectangular-scene.ts";
import type { Scene } from "../scene/scene-schema.ts";
import { buildItem } from "./build-item.ts";

export function buildTestScene(): Scene {
  const scene = createRectangularScene({
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  return {
    ...scene,
    room: { ...scene.room, surfaces: { floor: { color: "#c8b79a" } } },
    items: [
      buildItem({
        id: "sofa",
        placement: {
          kind: "floor",
          xM: -1.37,
          zM: 0.21,
          elevationM: 0,
          rotationRad: 0.3,
        },
        colorAdjust: { kind: "colorize", color: "#1e50e6", strength: 0.8 },
      }),
      buildItem({
        id: "port",
        placement: {
          kind: "wall",
          wallId: "wall-2",
          alongM: 1.2,
          heightM: 0.3,
          rotationRad: 0,
        },
      }),
      buildItem({
        id: "table",
        placement: {
          kind: "floor",
          xM: 1.63,
          zM: -0.47,
          elevationM: 0,
          rotationRad: 0,
        },
      }),
      buildItem({
        id: "lamp",
        placement: { kind: "ceiling", xM: 0.1, zM: 0.2, rotationRad: 0 },
      }),
      {
        ...buildItem({
          id: "box",
          placement: {
            kind: "floor",
            xM: 0.13,
            zM: 2.17,
            elevationM: 0.45,
            rotationRad: 1.1,
          },
        }),
        model: { kind: "pending", jobId: "job-1" },
      },
    ],
  };
}
