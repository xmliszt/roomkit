import { expect, test } from "vitest";
import { isOpeningName } from "../../scripts/a15/is-opening-name.ts";

for (const name of [
  "Sliding glass balcony door (dark frame, 3 panels)",
  "Open doorway with wood frame (bathroom)",
  "Window (above the desk)",
  "Double glass doors",
  "French window with white trim",
  "  WINDOW  ",
  "Door — balcony",
  "Front door",
  "Bathroom door",
  "Kitchen window",
  "Large window",
  "Arched window",
  "Main entrance door",
]) {
  test(`recognizes the opening noun in ${name}`, () => {
    expect(isOpeningName(name)).toBe(true);
  });
}

for (const name of [
  "Curtain (blue-grey, AC side of window)",
  "Curtains beside the window",
  "Blinds (window)",
  "Window blinds",
  "Sliding door curtains",
  "Framed print (doorway)",
  "Print of a doorway",
  "Wall panel (beside door)",
  "Door panel",
  "Door frame",
  "Door handle",
  "Window shutters",
  "Door-shaped mirror",
  "Cabinet with glass doors",
  "Glass cabinet door",
  "Wardrobe door",
  "Mirror door",
  "Panel window",
  "",
]) {
  test(`excludes the non-opening noun in ${name}`, () => {
    expect(isOpeningName(name)).toBe(false);
  });
}
