import type { Color, Vector3 } from "three";

/** The shader uniforms that make a lamp's shade glow, and the colour its light takes on passing through the shade. */
export type ShadeGlow = {
  uniforms: {
    uShadeGlowCentre: { value: Vector3 };
    uShadeGlowDirection: { value: Vector3 };
    uShadeGlowRadius: { value: number };
    uShadeGlowStrength: { value: number };
  };
  tint: Color;
};

export type ShadeGlowRegistry = { [itemId: string]: ShadeGlow };
