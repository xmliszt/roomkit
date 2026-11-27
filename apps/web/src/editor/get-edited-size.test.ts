import { expect, test } from "vitest";
import { getEditedSize } from "./get-edited-size.ts";

const sizeM = { width: 2, height: 1, depth: 0.5 };

test("an unlocked edit changes one axis", () => {
  expect(
    getEditedSize({
      sizeM,
      axis: "height",
      valueM: 3,
      isProportionLocked: false,
    }),
  ).toEqual({ width: 2, height: 3, depth: 0.5 });
});

test("a locked edit scales the other axes by the same ratio and keeps the typed value exact", () => {
  expect(
    getEditedSize({
      sizeM,
      axis: "width",
      valueM: 3,
      isProportionLocked: true,
    }),
  ).toEqual({ width: 3, height: 1.5, depth: 0.75 });
});
