import { expect, test } from "vitest";
import { createColorAdjustUniforms } from "./create-color-adjust-uniforms.ts";
import { setColorAdjustUniforms } from "./set-color-adjust-uniforms.ts";

test("colorize passes the target as sRGB components and defaults referenceLuma to 0.5", () => {
  const uniforms = createColorAdjustUniforms();
  setColorAdjustUniforms({
    uniforms,
    colorAdjust: { kind: "colorize", color: "#0080ff", strength: 0.4 },
    referenceLuma: undefined,
  });
  expect(uniforms.uColorMode.value).toBe(1);
  expect(uniforms.uColorTarget.value.toArray()).toEqual([0, 128 / 255, 1]);
  expect(uniforms.uColorStrength.value).toBe(0.4);
  expect(uniforms.uReferenceLuma.value).toBe(0.5);
});

test("shift sets its offsets, and no adjustment turns the patch off", () => {
  const uniforms = createColorAdjustUniforms();
  setColorAdjustUniforms({
    uniforms,
    colorAdjust: {
      kind: "shift",
      hueShiftDeg: -90,
      saturation: 0.2,
      lightness: -0.1,
    },
    referenceLuma: 0.3,
  });
  expect(uniforms.uColorMode.value).toBe(2);
  expect(uniforms.uColorShift.value.toArray()).toEqual([-90, 0.2, -0.1]);
  expect(uniforms.uReferenceLuma.value).toBe(0.3);
  setColorAdjustUniforms({
    uniforms,
    colorAdjust: undefined,
    referenceLuma: 0.3,
  });
  expect(uniforms.uColorMode.value).toBe(0);
});
