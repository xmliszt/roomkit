const startCompression = 0.8 - 0.04;
const desaturation = 0.15;

/** Replace the linear RGB in `color` with three.js's `NeutralToneMapping` of it at exposure 1. */
export function applyNeutralToneMapping(color: Float32Array) {
  const lowest = Math.min(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
  const offset = lowest < 0.08 ? lowest - 6.25 * lowest * lowest : 0.04;
  for (let channel = 0; channel < 3; channel += 1)
    color[channel] = (color[channel] ?? 0) - offset;
  const peak = Math.max(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
  if (peak < startCompression) return;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  for (let channel = 0; channel < 3; channel += 1) {
    const scaled = ((color[channel] ?? 0) * newPeak) / peak;
    color[channel] = scaled + (newPeak - scaled) * g;
  }
}
