import { expect, test } from "vitest";
import { getPhotoBox } from "./get-photo-box.ts";

test("reverse drags retain exclusive pixel edges and stay inside the upright photo", () => {
  expect(
    getPhotoBox({
      start: { x: 3500, y: 2500 },
      end: { x: -10, y: 12.6 },
      widthPx: 3000,
      heightPx: 2000,
    }),
  ).toEqual([0, 12, 3000, 2000]);
  expect(
    getPhotoBox({
      start: { x: 123.4, y: 210.7 },
      end: { x: 321.2, y: 401.8 },
      widthPx: 3000,
      heightPx: 2000,
    }),
  ).toEqual([123, 210, 322, 402]);
});
