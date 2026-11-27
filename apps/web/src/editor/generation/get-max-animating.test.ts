import { afterEach, expect, test, vi } from "vitest";
import { getMaxAnimating } from "./get-max-animating.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("defaults to 3 and takes a positive integer override", () => {
  vi.stubEnv("NEXT_PUBLIC_PLANNER_MAX_APPEARING", undefined);
  expect(getMaxAnimating()).toBe(3);
  vi.stubEnv("NEXT_PUBLIC_PLANNER_MAX_APPEARING", "8");
  expect(getMaxAnimating()).toBe(8);
  for (const value of ["", "0", "-2", "2.5", "many"]) {
    vi.stubEnv("NEXT_PUBLIC_PLANNER_MAX_APPEARING", value);
    expect(getMaxAnimating(), value).toBe(3);
  }
});
