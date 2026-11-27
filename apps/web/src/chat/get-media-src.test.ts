import { expect, test } from "vitest";
import { getMediaSrc } from "./get-media-src.ts";

test("only supported embedded media loads until project media routes exist", () => {
  expect(getMediaSrc("data:image/png;base64,aGVsbG8=")).toBe(
    "data:image/png;base64,aGVsbG8=",
  );
  for (const src of [
    "javascript:alert(1)",
    "data:text/html;base64,aGVsbG8=",
    "https://example.com/photo.png",
    "photos/photo.png",
    ".planner/links/image.png",
  ])
    expect(getMediaSrc(src)).toBeUndefined();
});
