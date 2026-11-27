import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import { expect, test } from "vitest";
import { getLightState } from "./get-light-state.ts";

const light = {
  on: true,
  emitter: { x: 0.5, y: 0.85, z: 0.5 },
  lumens: 400,
  temperatureK: 2700,
};
const placement = {
  kind: "floor",
  xM: 0,
  zM: 0,
  elevationM: 0,
  rotationRad: 0,
} as const;

test("labels the lights among a model's items", () => {
  const plain = buildItem({ id: "plain", placement });
  const lit = { ...buildItem({ id: "lit", placement }), light };
  const dark = {
    ...buildItem({ id: "dark", placement }),
    light: { ...light, on: false },
  };
  expect(getLightState([plain])).toBeUndefined();
  expect(getLightState([plain, lit])).toStrictEqual({
    total: 1,
    onCount: 1,
  });
  expect(getLightState([dark])).toStrictEqual({
    total: 1,
    onCount: 0,
  });
  expect(getLightState([lit, dark])).toStrictEqual({
    total: 2,
    onCount: 1,
  });
  expect(getLightState([dark, dark])).toStrictEqual({
    total: 2,
    onCount: 0,
  });
});
