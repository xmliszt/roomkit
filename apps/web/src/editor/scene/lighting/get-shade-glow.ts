import { Color, Vector3 } from "three";
import type { ShadeGlow, ShadeGlowRegistry } from "./shade-glow.ts";

/** Return the shade glow for `itemId` in `registry`, adding one that glows nowhere when there is none. */
export function getShadeGlow(options: {
  registry: ShadeGlowRegistry;
  itemId: string;
}): ShadeGlow {
  const existing = Object.hasOwn(options.registry, options.itemId)
    ? options.registry[options.itemId]
    : undefined;
  if (existing) return existing;
  const created = {
    uniforms: {
      uShadeGlowCentre: { value: new Vector3() },
      uShadeGlowDirection: { value: new Vector3() },
      uShadeGlowRadius: { value: 0 },
      uShadeGlowStrength: { value: 0 },
    },
    tint: new Color(1, 1, 1),
  };
  options.registry[options.itemId] = created;
  return created;
}
