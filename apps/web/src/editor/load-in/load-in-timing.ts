/* ANIMATION STORYBOARD — load-in, milliseconds after the item's turn starts
 *    0   nearby points gather onto the coloured surface over 490 ms
 *  270   edges trace over 490 ms
 *  600   surface reveals upward over 380 ms
 *  820   points fade over 220 ms
 *  980   lines fade over 220 ms
 * Starts are 80 ms apart, with ten active items. Reduced motion fades in 150 ms.
 */
export const LOAD_IN_TIMING = {
  gatherMs: 490,
  traceAtMs: 270,
  traceMs: 490,
  revealAtMs: 600,
  revealMs: 380,
  pointsOutAtMs: 820,
  pointsOutMs: 220,
  linesOutAtMs: 980,
  linesOutMs: 220,
  reducedMs: 150,
  staggerMs: 80,
  maxAnimating: 10,
};
