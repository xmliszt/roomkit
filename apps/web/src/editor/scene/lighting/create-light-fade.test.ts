import { expect, test } from "vitest";
import { createLightFade } from "./create-light-fade.ts";

test("starts and stops with 600 ms ease-out and 400 ms ease-in-out", () => {
  const fade = createLightFade();
  const advance = (options: { on: boolean; nowMs: number }) =>
    fade.advance({ ...options, reduced: false });
  expect(advance({ on: false, nowMs: 1000 })).toEqual({
    value: 0,
    active: false,
  });
  expect(advance({ on: true, nowMs: 1000 })).toEqual({
    value: 0,
    active: true,
  });
  expect(advance({ on: true, nowMs: 1300 })).toEqual({
    value: 0.875,
    active: true,
  });
  expect(advance({ on: true, nowMs: 1600 })).toEqual({
    value: 1,
    active: false,
  });
  expect(advance({ on: true, nowMs: 2000 })).toEqual({
    value: 1,
    active: false,
  });
  expect(advance({ on: false, nowMs: 2000 })).toEqual({
    value: 1,
    active: true,
  });
  expect(advance({ on: false, nowMs: 2100 })).toEqual({
    value: 0.9375,
    active: true,
  });
  expect(advance({ on: false, nowMs: 2200 })).toEqual({
    value: 0.5,
    active: true,
  });
  expect(advance({ on: false, nowMs: 2300 })).toEqual({
    value: 0.0625,
    active: true,
  });
  expect(advance({ on: false, nowMs: 2400 })).toEqual({
    value: 0,
    active: false,
  });
});

test("reverses from its current level and skips fades under reduced motion", () => {
  const fade = createLightFade();
  fade.advance({ on: true, nowMs: 0, reduced: false });
  expect(fade.advance({ on: false, nowMs: 300, reduced: false }).value).toBe(
    0.875,
  );
  expect(fade.advance({ on: false, nowMs: 500, reduced: false }).value).toBe(
    0.4375,
  );
  expect(fade.advance({ on: true, nowMs: 500, reduced: false }).value).toBe(
    0.4375,
  );
  expect(fade.advance({ on: true, nowMs: 550, reduced: true })).toEqual({
    value: 1,
    active: false,
  });
  expect(fade.advance({ on: false, nowMs: 560, reduced: true })).toEqual({
    value: 0,
    active: false,
  });
  expect(fade.advance({ on: false, nowMs: 570, reduced: false })).toEqual({
    value: 0,
    active: false,
  });
});
