# S0 — Python environment

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 7, row S0. S1, S2, S3 and S6 wait on this spike.

## Question

Does a `uv`-managed Python 3.13 environment with `mlx-spatial` install cleanly on this machine (M1 Pro, 32 GB, macOS 27, system Python 3.15)?

## Steps

1. `uv` 0.13.9 is already installed at `/opt/homebrew/bin/uv`. If you need Homebrew, use `/opt/homebrew/bin/brew`; the `/usr/local/bin/brew` that comes first in PATH builds from source.
2. `python/pyproject.toml` pinned to Python 3.13, managed by `uv`. The environment lives at `python/.venv` (gitignored) for the spike. The app's own location (`~/.interior-planner/python/`) is set up later by the Settings install job, not here.
3. Add `mlx-spatial` and what it needs. Find its real package name and install route; if it is not on PyPI, install it from its source repository and record the exact commit.
4. Also try these in the same env, without downloading any weights: `mlx`, `torch` (MPS available), `opencv-contrib-python` (`cv2.aruco`), `numpy`, `pillow`, `pillow-heif`. Later spikes need them. They do not gate S0: report a failure here and move on.
5. Do not download model weights. Import checks only.

## Paths

`python/` (`pyproject.toml`, committed `uv.lock`, `spikes/s0_check_env.py`) and `docs/spikes/s0-python-env.md`. The root `.gitignore` already covers `.venv/`.

## Gate

`uv run --project python python python/spikes/s0_check_env.py` exits 0 when the `mlx-spatial` imports succeed. It also prints each other import from step 4 with its version or its error, and `torch.backends.mps.is_available()`, without failing on them.

## Report (`docs/spikes/s0-python-env.md`)

Versions, install commands, install size on disk, time taken, anything that needed a workaround. If `mlx-spatial` cannot share an env with the rest, say which packages conflict and set up the fallback from PLAN 7 (separate envs per tool), then report both.
