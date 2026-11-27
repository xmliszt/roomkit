import { Vector3 } from "three";
import type { ColorAdjustUniforms } from "./color-adjust-uniforms.ts";

/** Return shader uniforms that leave the base colour unchanged. */
export function createColorAdjustUniforms(): ColorAdjustUniforms {
  return {
    uColorMode: { value: 0 },
    uColorTarget: { value: new Vector3() },
    uColorStrength: { value: 0 },
    uColorShift: { value: new Vector3() },
    uReferenceLuma: { value: 0.5 },
  };
}
