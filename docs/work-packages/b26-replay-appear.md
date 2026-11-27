# B26: more objects appearing at once in the replay

`scripts/demo/replay.ts --max-appearing <n>` sets `NEXT_PUBLIC_PLANNER_MAX_APPEARING` on the replay's own `next dev`. `getMaxAnimating()` returns it when it is a positive integer, else `GENERATION_POINTS.maxAnimating` (3), so the user's app is unchanged. The replay records the peak count of tags in the `generating` or `ready` look as `peakAppearing` in `result.json`.

There is no `--max-generating`: the two-at-a-time generation limit is in the daemon (`create-generation-queue.ts`, `activeCounts[record.job.kind] >= 2`).

Gate: `get-max-animating.test.ts`; `replay.ts /path/to/project --piece-seconds 1 --recon-seconds 3 --max-appearing 8 --finish` with `peakAppearing` ≥ 6, no failed jobs, process audit clean.
