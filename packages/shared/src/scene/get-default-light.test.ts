import { expect, test } from "vitest";
import { getDefaultLight } from "./get-default-light.ts";

test.each([
  {
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0.7, rotationRad: 0 },
    emitter: { x: 0.5, y: 0.85, z: 0.5 },
    beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
    lumens: 400,
    temperatureK: 2700,
  },
  {
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    emitter: { x: 0.5, y: 0.85, z: 0.5 },
    beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
    lumens: 800,
    temperatureK: 2700,
  },
  {
    placement: { kind: "ceiling", xM: 0, zM: 0, rotationRad: 0 },
    emitter: { x: 0.5, y: 0.1, z: 0.5 },
    beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
    lumens: 1500,
    temperatureK: 3000,
  },
  {
    placement: {
      kind: "wall",
      wallId: "wall-1",
      alongM: 1,
      heightM: 1.6,
      rotationRad: 0,
    },
    emitter: { x: 0.5, y: 0.6, z: 0.6 },
    beam: undefined,
    lumens: 400,
    temperatureK: 2700,
  },
] as const)("a $placement.kind light starts on at $lumens lm", (entry) => {
  expect(getDefaultLight(entry.placement)).toStrictEqual({
    on: true,
    emitter: entry.emitter,
    ...(entry.beam === undefined ? {} : { beam: entry.beam }),
    lumens: entry.lumens,
    temperatureK: entry.temperatureK,
  });
});
