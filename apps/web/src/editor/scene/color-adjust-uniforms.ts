import type { Vector3 } from "three";

export type ColorAdjustUniforms = {
  uColorMode: { value: number };
  uColorTarget: { value: Vector3 };
  uColorStrength: { value: number };
  uColorShift: { value: Vector3 };
  uReferenceLuma: { value: number };
};
