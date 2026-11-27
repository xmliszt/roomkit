import { expect, test } from "vitest";
import { resolveBlenderBinary } from "./resolve-blender-binary.ts";

test("maps a .app bundle to its binary and keeps any other path", () => {
  expect(resolveBlenderBinary("/Applications/Blender.app/")).toBe(
    "/Applications/Blender.app/Contents/MacOS/Blender",
  );
  expect(resolveBlenderBinary("/opt/homebrew/bin/blender")).toBe(
    "/opt/homebrew/bin/blender",
  );
});
