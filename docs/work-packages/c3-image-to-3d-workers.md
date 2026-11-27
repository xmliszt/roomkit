# C3 — Image-to-3D workers (TRELLIS.2 and SAM 3D) for "try another version"

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 5.1 (decision paragraph) and 2 (python runner); `docs/spikes/s2-image-to-3d.md` (settings that work on this Mac, axes and units per generator, the memory guard, the 1536 px cap, timings) and its code in `python/spikes/s2/`; `python/README.md` (worker protocol).

## Scope (`python/` outside `python/spikes/`, the model registry `packages/daemon/src/preflight/model-registry.json`, and `scripts/gate-c3.sh`)

1. `python/workers/generate_trellis.py` and `python/workers/generate_sam3d.py`: JSON on stdin (`photoPath`, optional `maskPath`, `outputDir`), progress lines, final result (`glbPath`, `sourceUp`, `sourceFront`, timing, peak memory). Use S2's working settings. A mask: SAM 3D takes photo plus mask; TRELLIS.2 takes the RGBA crop made from the mask (no RMBG when a mask exists).
2. Merge the dependencies into `python/pyproject.toml` and `uv.lock`.
3. Registry entries for the weights the two workers need (TRELLIS.2, DINOv3, RMBG-2.0, SAM 3D MLX), with the ungated copies S2 used, exact files and sizes, so preflight and Settings show them and weights adoption marks the existing downloads present.

## Rules

Measured runs under `scripts/machine-lock.sh c3 …`. Unit tests without weights. You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `uv run --project python pytest python/tests` passes.
2. `scripts/gate-c3.sh` (under the lock): both workers on S3's sofa set (`~/.cache/interior-planner-spikes/s3/s2/sofa`) and on one product photo from `~/.cache/interior-planner-spikes/s2/products/`; each GLB passes the glTF validator; each run reports axes, time and peak memory; each under 15 minutes.
