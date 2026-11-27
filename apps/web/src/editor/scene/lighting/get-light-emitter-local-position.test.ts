import { expect, test } from "vitest";
import { getItemBox } from "../../../items/get-item-box.ts";
import { getLightEmitterLocalPosition } from "./get-light-emitter-local-position.ts";

const sizeM = { width: 1, height: 2, depth: 0.5 };
const emitter = { x: 0.25, y: 0.85, z: 0.6 };

test.each([
  { kind: "floor", mirrored: false, expected: { x: -0.25, y: 1.7, z: 0.05 } },
  { kind: "floor", mirrored: true, expected: { x: 0.25, y: 1.7, z: 0.05 } },
  { kind: "wall", mirrored: false, expected: { x: -0.25, y: 0.7, z: 0.3 } },
  {
    kind: "ceiling",
    mirrored: false,
    expected: { x: -0.25, y: -0.3, z: 0.05 },
  },
] as const)(
  "a $kind item (mirrored $mirrored) reads the emitter across its own box",
  (entry) => {
    const position = getLightEmitterLocalPosition({
      emitter,
      box: getItemBox({ placementKind: entry.kind, sizeM }),
      mirrored: entry.mirrored,
    });
    expect(position.x).toBeCloseTo(entry.expected.x);
    expect(position.y).toBeCloseTo(entry.expected.y);
    expect(position.z).toBeCloseTo(entry.expected.z);
  },
);
