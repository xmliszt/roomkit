# B20 — Stable, correct TRELLIS.2 and SAM 3D alternatives (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` (generation alternatives, B10/B11/B17), spike reports for S2 (image-to-3D) and S3 (segmentation). Code: `packages/daemon/src/generation/run-alternative-worker.ts`, `create-generation-queue.ts`, `prepare-generation-folder.ts`, `check-generated-asset.ts`, `python/workers/` (image-to-3D and segmentation workers), the Blender normalize step, `scripts/b11-real-alternatives.ts`. Consult the advisor before committing to an approach and before calling it done. B19 (multi-photo references) runs in parallel and touches `prepare-generation-folder.ts`; merge `orchestrator` often.

## Evidence (user's project `/path/to/project`, read only)

Only 1 of the last 11 "try another version" jobs succeeded:

| job | method | result | worker time | masks |
|---|---|---|---|---|
| 619ef2ea, ffe5a979, 70a11ca8 | trellis2 | timed out after 900 s | — | 7 |
| 11220237, 24424ff7, faa1315c | sam3d | timed out after 900 s | — | 7 / 7 / 0 |
| 7aa1778b | sam3d | wrong proportions (depth) | 686 s | 7 |
| 84a03ba4, ffd6b15c | trellis2 | wrong proportions: height 0.217 m, expected 0.667 m | 421 / 373 s | 0 |
| 11fc3dda | sam3d | ready | 873 s (27 s under the limit) | 0 |

Bean bag (`ffd6b15c`): the reference is a 480 px chat photo of the bean bag on a wooden floor against a wall, with no mask. The TRELLIS.2 mesh is 1.0 × 1.0 × 0.217 (normalized), and 54,606 of ~115k vertices sit in the lowest tenth of the height: it rebuilt the floor as a wide flat slab, which made the object read as flat.

## Scope

1. **Mask every reference.** Chat-photo and web references reach image-to-3D with no mask. Segment the object (the project's existing segmentation worker, prompted with the object's name, or a box from the designer) and pass the masked image to TRELLIS.2 / SAM 3D. Fall back to background removal if segmentation finds nothing; never send an unmasked photo with a visible floor or wall.
2. **Clean the output.** After generation, drop disconnected pieces and any large flat slab at the base (floor or wall remnants) before the size and proportion check. Unit test with a synthetic mesh: object + floor slab → object only.
3. **Timeouts.** Replace the fixed 900 s total limit with an inactivity limit (no real progress for N minutes) plus a hard cap sized from measured runs (record durations in metrics). Workers must report real progress, not a heartbeat only. Find out why runs take > 15 min: measure memory, check that only one heavy ML job runs on the machine at a time (TRELLIS.2, SAM 3D, segmentation, reconstruction), check for swap. Report the numbers.
4. **Proportion failures.** Keep the check. Format the message for people: `Wrong proportions: height 0.22 m, expected 0.67 m (±20%)`. Keep the rejected model file and show its preview in the failed job, so the user can see what came out.
5. **Docs:** PLAN section on alternatives: masking, cleanup, timeout policy, measured durations.

## Gate

`pnpm check`, all gates, pytest, `pnpm test:e2e --workers=1` (outside ports 3210 and 4820). Real runs (copy inputs into a temp project; never write to the user's project): the bean bag photo through TRELLIS.2 and SAM 3D both produce a model that passes the proportion check within the new limits; plus one inventory object that timed out before (the source of `619ef2ea`) through both methods. Put durations, peak memory and before/after renders in `docs/work-packages/evidence/b20-*.{txt,png}`.
