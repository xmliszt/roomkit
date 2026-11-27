import { expect, test } from "vitest";
import { applyNeutralToneMapping } from "./apply-neutral-tone-mapping.ts";

test("keeps mid tones apart from the black offset and compresses highlights below 1", () => {
  const mid = Float32Array.of(0.5, 0.4, 0.3);
  applyNeutralToneMapping(mid);
  expect(mid[0]).toBeCloseTo(0.46);
  expect(mid[1]).toBeCloseTo(0.36);
  expect(mid[2]).toBeCloseTo(0.26);
  const bright = Float32Array.of(4, 3, 2);
  applyNeutralToneMapping(bright);
  expect(Math.max(...bright)).toBeLessThan(1);
  expect(bright[0]).toBeGreaterThan(bright[2] ?? 1);
});
