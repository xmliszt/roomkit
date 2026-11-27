import { expect, test } from "vitest";
import { getPublishedSize } from "./get-published-size.ts";

test("keeps the displayed size when every axis is within 20%", () => {
  const displayedM = { width: 1.5, height: 0.5, depth: 0.8 };
  expect(
    getPublishedSize({
      displayedM,
      modelM: { width: 1.2, height: 0.45, depth: 0.6 },
    }),
  ).toEqual({ sizeM: displayedM, isDisplayedSize: true });
});

test("publishes the model's proportions with the displayed largest side when an axis is off by more than 20%", () => {
  const result = getPublishedSize({
    displayedM: { width: 1, height: 0.67, depth: 0.92 },
    modelM: { width: 1, height: 0.49, depth: 0.95 },
  });
  expect(result.isDisplayedSize).toBe(false);
  expect(result.sizeM.width).toBeCloseTo(1);
  expect(result.sizeM.height).toBeCloseTo(0.49);
  expect(result.sizeM.depth).toBeCloseTo(0.95);
});

test("scales the model to the displayed largest side before comparing", () => {
  const displayedM = { width: 2, height: 1, depth: 1 };
  expect(
    getPublishedSize({
      displayedM,
      modelM: { width: 1, height: 0.5, depth: 0.5 },
    }),
  ).toEqual({ sizeM: displayedM, isDisplayedSize: true });
});

test("a thin rug within 5 mm keeps its displayed size", () => {
  const displayedM = { width: 2, height: 0.008, depth: 1.4 };
  expect(
    getPublishedSize({
      displayedM,
      modelM: { width: 2, height: 0.012, depth: 1.4 },
    }).isDisplayedSize,
  ).toBe(true);
});
