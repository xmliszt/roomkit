import { expect, test } from "vitest";
import { findSizeMismatches } from "./find-size-mismatches.ts";

test.each([
  { height: 0.011, mismatched: false },
  { height: 0.013, mismatched: false },
  { height: 0.03, mismatched: true },
])(
  "an 8 mm rug measured at $height m is a mismatch: $mismatched",
  (options) => {
    expect(
      findSizeMismatches({
        expected: { width: 2, height: 0.008, depth: 1.4 },
        actual: { width: 2, height: options.height, depth: 1.4 },
      }).length > 0,
    ).toBe(options.mismatched);
  },
);

test("reports each smaller axis off by more than 20%, never the largest", () => {
  expect(
    findSizeMismatches({
      expected: { width: 1, height: 0.67, depth: 0.92 },
      actual: { width: 1.5, height: 0.49, depth: 0.99 },
    }),
  ).toEqual([{ axis: "height", actualM: 0.49, expectedM: 0.67 }]);
  expect(
    findSizeMismatches({
      expected: { width: 2, height: 0.008, depth: 1.4 },
      actual: { width: 2, height: 0.008, depth: 1.1 },
    }),
  ).toEqual([{ axis: "depth", actualM: 1.1, expectedM: 1.4 }]);
});
