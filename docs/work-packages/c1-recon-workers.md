# C1 — Python workers: intake, room geometry, segmentation

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 (python runner, state on disk), 5.2 steps 1–5 and 7, and 7; `docs/spikes/s1-room-geometry.md` and `docs/spikes/s3-segmentation.md` (the chosen models and the spike code in `python/spikes/s1/` and `python/spikes/s3/`); `docs/spikes/test-data.md`.

## Scope (`python/` outside `python/spikes/`, plus the new `scripts/gate-c1.sh`)

Turn the spike code into worker scripts the daemon will call (one process per job, JSON on stdin, JSON lines of progress and a final JSON result on stdout, non-zero exit on failure). Merge the chosen models' dependencies into `python/pyproject.toml` and `uv.lock` (MapAnything via `mlx-spatial`; SAM 3 via `mlx-vlm` with `mlx-community/sam3-bf16`; SAM 2.1 as fallback).

1. **`python/workers/intake.py`** (5.2 step 1): HEIC to JPEG, EXIF orientation, per-photo focal length and lens, blur rejection, 1568 px copies for agent vision, `photos.json` entries (schema: match `packages/shared` if it has a photo schema; otherwise propose one in your final message and do not edit `packages/`).
2. **`python/workers/reconstruct.py`** (steps 3–4): MapAnything on the photos with S1's settings (chunked dense head, capped MLX cache), the layout fit (gravity, floor, ceiling, wall planes, right angles unless the residual says otherwise, a closed footprint with `inferred` walls), per-wall confidence from inlier count and residual, scale from the sources in step 2 in order (typed measurement, known furniture size from a mask, model metric as weak). Output `walls` (counter-clockwise per PLAN 3), `ceilingHeightM`, confidence, scale source, camera poses and point cloud into `recon/`.
3. **`python/workers/coverage.py`** (step 5): per wall and floor, area share with points and number of cameras that see it; capture requests for walls below threshold or `inferred`.
4. **`python/workers/segment.py`** (step 7): box to mask with SAM 3 MLX, SAM 2.1 fallback; mask in every photo that shows the object.

## Rules

- Weights already downloaded live in `~/.interior-planner/python/weights/` (MapAnything, SAM 2.1, SAM 3 MLX); the workers take the weights folder as input. Tests point it at the real folder only in the gate run below, never in unit tests.
- Unit tests (pytest) with small synthetic inputs, no model weights.
- Measured model runs go through `scripts/machine-lock.sh c1 <command>`.
- You are a Codex agent: you have no `advisor` tool. Where the brief and PLAN are silent, make the routine call and list it in your final message; for a contract question, stop and report.

## Gate

1. `uv run --project python pytest python/tests` passes.
2. Use a separately supplied fixture with measurements and annotated scale. See [Python verification](../../python/README.md#verification).
