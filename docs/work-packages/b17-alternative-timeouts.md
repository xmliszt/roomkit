# B17 — Alternative jobs: timeouts that ignore the lock wait, and the TRELLIS.2 stall

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (generation contracts, alternatives) and the TRELLIS.2 "Known limit" paragraph in section 8; `packages/daemon/src/generation/run-alternative-worker.ts`, `packages/daemon/src/python/run-python-worker.ts`, `scripts/machine-lock.sh`.

## Bug (seen in the user's app)

`alternative · trellis2` failed at 5% with "Python worker timed out after 900000 ms". The worker is started through `scripts/machine-lock.sh`, and the timeout wraps the whole wrapper, so time spent waiting for the lock counts as run time. TRELLIS.2 also stalls in mesh export now and then (S2, B11).

## Scope (`packages/daemon`, `packages/shared` if a stage is added, `scripts/machine-lock.sh`, `python/workers/generate_trellis.py`, and in `apps/web/src/` only the job row and job strip text)

1. The timeout starts when the worker holds the lock. The lock script prints a line when it acquires the lock (or writes a marker the daemon can watch); until then the job shows a `waiting` state ("waiting for the machine") with no progress.
2. TRELLIS.2: a 12-minute limit after the lock is held; on a stall, one automatic retry at the lower face count / `--pipeline-type 512` setting S2 used, then fail with "TRELLIS.2 stalled" while the sibling SAM 3D job continues. SAM 3D keeps 15 minutes.
3. A failed alternative offers retry for that method only (`generation.alternatives` with an optional `method`).

4. **Raw worker output stays out of chat** (seen in the user's app: a modeler message showed the normalize `RESULT {…}` JSON as text). Worker and Blender output go to the job log and the Log tab; chat gets the `job` and `asset` blocks only.
5. **Textures over 2048 px are downscaled** by `blender/normalize.py` before the gate, not failed ("Texture exceeds 2048 px" failed a framed print in the user's project). `blender/` is in scope for this item.

Codex: no `advisor`; follow the README's Codex rule. Do not stop the user's running daemon or its workers.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. Tests with a fake lock holder and fake workers: a job that waits 2 minutes for the lock and then runs 1 minute succeeds under a 90-second run limit; a stalled fake TRELLIS.2 is retried once then fails with the stall message while the SAM 3D sibling finishes; retry for one method queues only that method.
