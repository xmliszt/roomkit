/* ANIMATION STORYBOARD — milliseconds after all asset files load
 *    0   box points crossfade to coloured surface points; box changes size
 *  500   lines trace longest first over 900 ms
 * 1100   surface reveals upward over 700 ms
 * 1500   points fade over 400 ms
 * 1800   lines fade over 400 ms
 * Reduced motion: box and model crossfade over 200 ms.
 */
export const APPEARANCE_TIMING = {
  gatherMs: 900,
  traceAtMs: 500,
  traceMs: 900,
  revealAtMs: 1100,
  revealMs: 700,
  pointsOutAtMs: 1500,
  pointsOutMs: 400,
  linesOutAtMs: 1800,
  linesOutMs: 400,
  reducedMs: 200,
};

export const GENERATION_POINTS = {
  count: 5000,
  maxSizePx: 17,
  focusedSizePx: 2.6,
  maxAnimating: 3,
};
