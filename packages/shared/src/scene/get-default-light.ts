import type { Item } from "./item-schema.ts";
import type { Light } from "./light-schema.ts";

/** Return the light a newly marked light source starts with, from its mount: a table lamp (a floor item standing on something) or a floor lamp beaming down 90°, a ceiling light beaming down 120°, or a wall light shining all round. */
export function getDefaultLight(placement: Item["placement"]): Light {
  switch (placement.kind) {
    case "floor":
      return {
        on: true,
        emitter: { x: 0.5, y: 0.85, z: 0.5 },
        beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
        lumens: placement.elevationM > 0 ? 400 : 800,
        temperatureK: 2700,
      };
    case "ceiling":
      return {
        on: true,
        emitter: { x: 0.5, y: 0.1, z: 0.5 },
        beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
        lumens: 1500,
        temperatureK: 3000,
      };
    case "wall":
      return {
        on: true,
        emitter: { x: 0.5, y: 0.6, z: 0.6 },
        lumens: 400,
        temperatureK: 2700,
      };
    default: {
      const unreachable: never = placement;
      return unreachable;
    }
  }
}
