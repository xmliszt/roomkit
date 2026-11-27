import { objectEnvironmentIntensity } from "../object-environment-intensity.ts";

/** The ambient, key and environment intensities with every lamp off (`unlit`) and with at least one on (`lit`). */
export const roomLighting = {
  unlit: { ambient: 1.6, key: 1.4, environment: objectEnvironmentIntensity },
  lit: { ambient: 0.6, key: 0.2, environment: 0.4 },
} as const;
