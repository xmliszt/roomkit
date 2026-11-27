import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";
import type { ColorAdjustUniforms } from "./color-adjust-uniforms.ts";

const defaultReferenceLuma = 0.5;

/** Write `colorAdjust` and `referenceLuma` into `uniforms`, with the target colour as sRGB-encoded components. */
export function setColorAdjustUniforms(options: {
  uniforms: ColorAdjustUniforms;
  colorAdjust: ColorAdjust | undefined;
  referenceLuma: number | undefined;
}) {
  const { uniforms, colorAdjust } = options;
  uniforms.uReferenceLuma.value = options.referenceLuma ?? defaultReferenceLuma;
  if (colorAdjust === undefined) {
    uniforms.uColorMode.value = 0;
    return;
  }
  switch (colorAdjust.kind) {
    case "colorize": {
      const hex = Number.parseInt(colorAdjust.color.slice(1), 16);
      uniforms.uColorMode.value = 1;
      uniforms.uColorTarget.value.set(
        ((hex >> 16) & 0xff) / 255,
        ((hex >> 8) & 0xff) / 255,
        (hex & 0xff) / 255,
      );
      uniforms.uColorStrength.value = colorAdjust.strength;
      return;
    }
    case "shift":
      uniforms.uColorMode.value = 2;
      uniforms.uColorShift.value.set(
        colorAdjust.hueShiftDeg,
        colorAdjust.saturation,
        colorAdjust.lightness,
      );
      return;
    default: {
      const unreachable: never = colorAdjust;
      return unreachable;
    }
  }
}
