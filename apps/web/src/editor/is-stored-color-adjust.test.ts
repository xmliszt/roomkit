import { expect, test } from "vitest";
import { isStoredColorAdjust } from "./is-stored-color-adjust.ts";

const blue = { kind: "colorize", color: "#1e50e6", strength: 1 } as const;

test("a preview back at the stored value counts as stored", () => {
  expect(isStoredColorAdjust({ shown: null, stored: undefined })).toBe(true);
  expect(
    isStoredColorAdjust({ shown: blue, stored: { ...blue, color: "#1E50E6" } }),
  ).toBe(true);
});

test("a changed preview does not", () => {
  expect(
    isStoredColorAdjust({ shown: { ...blue, strength: 0.5 }, stored: blue }),
  ).toBe(false);
  expect(isStoredColorAdjust({ shown: null, stored: blue })).toBe(false);
  expect(isStoredColorAdjust({ shown: blue, stored: undefined })).toBe(false);
});
