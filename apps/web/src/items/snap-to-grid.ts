const stepsPerMeter = 20;

/** Return `valueM` rounded to the nearest 0.05 m. */
export function snapToGrid(valueM: number) {
  return Math.round(valueM * stepsPerMeter) / stepsPerMeter;
}
