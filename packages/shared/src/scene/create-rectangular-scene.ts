import type { Scene } from "./scene-schema.ts";

/** Return a scene with no items and a four-wall room of the given size, centred on the origin. */
export function createRectangularScene(options: {
  widthM: number;
  depthM: number;
  ceilingHeightM: number;
}): Scene {
  const halfWidthM = options.widthM / 2;
  const halfDepthM = options.depthM / 2;
  const reachM = Math.max(options.widthM, options.depthM);
  return {
    version: 1,
    room: {
      walls: [
        {
          id: "wall-1",
          startM: { x: -halfWidthM, z: -halfDepthM },
          kind: "solid",
        },
        {
          id: "wall-2",
          startM: { x: -halfWidthM, z: halfDepthM },
          kind: "solid",
        },
        {
          id: "wall-3",
          startM: { x: halfWidthM, z: halfDepthM },
          kind: "solid",
        },
        {
          id: "wall-4",
          startM: { x: halfWidthM, z: -halfDepthM },
          kind: "solid",
        },
      ],
      ceilingHeightM: options.ceilingHeightM,
      surfaces: {},
    },
    items: [],
    camera: {
      positionM: { x: reachM, y: options.ceilingHeightM * 1.5, z: reachM },
      targetM: { x: 0, y: options.ceilingHeightM / 2, z: 0 },
    },
  };
}
