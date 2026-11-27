import { expect, test } from "vitest";
import { getItemBox } from "../../../items/get-item-box.ts";
import { getLightEmitterFromPosition } from "./get-light-emitter-from-position.ts";

test.each(["floor", "wall", "ceiling"] as const)(
  "drag clamps every axis to the %s box",
  (placementKind) => {
    const box = getItemBox({
      placementKind,
      sizeM: { width: 2, height: 4, depth: 1 },
    });
    expect(
      getLightEmitterFromPosition({
        positionM: { x: -100, y: 100, z: -100 },
        box,
        mirrored: false,
      }),
    ).toEqual({ x: 0, y: 1, z: 0 });
    expect(
      getLightEmitterFromPosition({
        positionM: { x: 100, y: -100, z: 100 },
        box,
        mirrored: true,
      }),
    ).toEqual({ x: 0, y: 0, z: 1 });
    expect(
      getLightEmitterFromPosition({
        positionM: { x: -0.5, y: box.y.min + 1, z: box.z.min + 0.6 },
        box,
        mirrored: true,
      }),
    ).toEqual({ x: 0.75, y: 0.25, z: 0.6 });
  },
);
