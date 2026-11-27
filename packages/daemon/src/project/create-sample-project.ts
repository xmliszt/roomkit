import { randomUUID } from "node:crypto";
import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import namesByLocale from "./sample-room-names.json" with { type: "json" };

export function createSampleProject(locale: AppLocale = "en") {
  const names = namesByLocale[locale];
  const scene = createRectangularScene({
    widthM: 4.8,
    depthM: 4.2,
    ceilingHeightM: 2.65,
  });

  return ProjectSchema.parse({
    id: randomUUID(),
    name: names.room,
    sample: true,
    revision: 0,
    scene: {
      ...scene,
      room: {
        ...scene.room,
        surfaces: {
          floor: { color: "#bb9a76" },
          "wall-1": { color: "#dbd6c6" },
          "wall-4": { color: "#c1c9b3" },
        },
      },
      camera: {
        positionM: { x: 5.8, y: 4.1, z: 5.4 },
        targetM: { x: 0, y: 0.65, z: 0 },
      },
      items: [
        {
          name: names.sofa,
          id: "sofa",
          sizeM: { width: 2.19365, height: 0.869359, depth: 0.892743 },
          xM: -0.25,
          zM: -1.43,
          rotationRad: 0,
        },
        {
          name: names.chair,
          id: "chair",
          sizeM: { width: 0.786184, height: 0.829119, depth: 0.760905 },
          xM: -1.58,
          zM: 0.5,
          rotationRad: 1.94,
        },
        {
          name: names.table,
          id: "table",
          sizeM: { width: 1.22, height: 0.425, depth: 0.62 },
          xM: -0.18,
          zM: -0.21,
          rotationRad: 0,
        },
        {
          name: names.rug,
          id: "rug",
          sizeM: { width: 2.567936, height: 0.012, depth: 1.8 },
          xM: -0.3,
          zM: -0.33,
          rotationRad: 0,
        },
        {
          name: names.lamp,
          id: "lamp",
          sizeM: { width: 0.4, height: 1.6, depth: 0.4 },
          xM: 1.37,
          zM: -1.42,
          rotationRad: 0,
          light: {
            on: false,
            emitter: { x: 0.5, y: 0.9, z: 0.5 },
            beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 100 },
            shade: "translucent",
            lumens: 800,
            temperatureK: 2700,
          },
        },
      ].map(({ name, id, sizeM, xM, zM, rotationRad, light }) => ({
        id,
        name,
        model: { kind: "asset", assetId: `sample-${id}` },
        placement: { kind: "floor", xM, zM, rotationRad, elevationM: 0 },
        sizeM,
        locked: id === "rug",
        ...(light === undefined ? {} : { light }),
      })),
    },
  });
}
