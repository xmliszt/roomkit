# C2 — Fixes to the reconstruction workers from the C1 review

Read `docs/work-packages/README.md` first. Spec: `docs/work-packages/c1-recon-workers.md` (the original brief), `docs/PLAN.md` sections 3 and 5.2 steps 3–5, and the review findings in `docs/work-packages/findings/c1-review.md`.

## Scope (`python/` outside `python/spikes/`, `scripts/gate-c1.sh`)

Fix all six findings in `docs/work-packages/findings/c1-review.md`. Each fix comes with a test that fails without it:

1. Wall refits stay in their orientation group and are checked against the observed bounds; an unsupported or invalid refit becomes an `inferred` wall. The footprint always closes (PLAN 5.2 step 4). Add partial-capture tests (one wall, two adjacent walls, two opposing walls visible).
2. Missing extents come from floor and ceiling support and camera positions, enclosing every observation.
3. Wall ids are kept by physical wall across reconstructions (match planes after registering through shared cameras), not by coordinate order. Test a changed reconstruction basis.
4. The gate scores both pairs of opposite sides and the corner angles against the reference; extract the scorer into a tested function that rejects the review's 5.300 / 3.100 / 5.302 / 4.656 m example.
5. Final wall planes are refit on all consistent inliers, not only the RANSAC sample.
6. Fix the geometry fixture's camera orientation; assert floor points map to y = 0 and ceiling points to positive `ceilingHeightM`.

Also: do not tilt a wall away from a right angle unless the residual improvement is clear on all inliers; report in your final message the room numbers before and after, against S1's −1% / +4% / 0%.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `uv run --project python pytest python/tests` passes with the new tests.
2. `scripts/gate-c1.sh` passes with the stricter scorer: both width sides and both length sides within 10% of the reference, corners within 5° of 90°.
