import { APPEARANCE_TIMING } from "./appearance-timing.ts";

export function getAppearanceFrame(options: {
  elapsedMs: number;
  reduced: boolean;
  timing?: typeof APPEARANCE_TIMING;
}) {
  const timing = options.timing ?? APPEARANCE_TIMING;
  function progress(input: { startMs: number; durationMs: number }) {
    return Math.min(
      1,
      Math.max(0, (options.elapsedMs - input.startMs) / input.durationMs),
    );
  }
  const reduced = progress({ startMs: 0, durationMs: timing.reducedMs });
  const gather = progress({ startMs: 0, durationMs: timing.gatherMs });
  const trace = progress({
    startMs: timing.traceAtMs,
    durationMs: timing.traceMs,
  });
  const reveal = progress({
    startMs: timing.revealAtMs,
    durationMs: timing.revealMs,
  });
  return {
    gather: options.reduced ? 1 : gather,
    trace: options.reduced ? 0 : 1 - (1 - trace) ** 3,
    reveal: options.reduced ? 1 : 1 - (1 - reveal) ** 3,
    modelOpacity: options.reduced ? reduced : 1,
    boxOpacity: options.reduced ? 1 - reduced : 1 - gather,
    pointsOpacity: options.reduced
      ? 0
      : 1 -
        progress({
          startMs: timing.pointsOutAtMs,
          durationMs: timing.pointsOutMs,
        }),
    linesOpacity: options.reduced
      ? 0
      : 1 -
        progress({
          startMs: timing.linesOutAtMs,
          durationMs: timing.linesOutMs,
        }),
    done:
      options.elapsedMs >=
      (options.reduced
        ? timing.reducedMs
        : timing.linesOutAtMs + timing.linesOutMs),
  };
}
