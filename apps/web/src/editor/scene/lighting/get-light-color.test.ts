import { expect, test } from "vitest";
import { getLightColor } from "./get-light-color.ts";

test("warm light is red-heavy and daylight is near white", () => {
  const warm = getLightColor(2700);
  expect(warm.r).toBeGreaterThan(warm.g);
  expect(warm.g).toBeGreaterThan(warm.b);
  const daylight = getLightColor(6600);
  expect(daylight.r).toBeCloseTo(1, 1);
  expect(daylight.g).toBeCloseTo(1, 1);
  expect(daylight.b).toBeCloseTo(1, 1);
});
