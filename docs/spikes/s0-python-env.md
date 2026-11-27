# S0 — Python environment: result

**Pass.** One `uv`-managed Python 3.13 environment holds `mlx-spatial` and every package the later spikes asked for. No conflict, no workaround, no separate environments needed.

Run on 2026-11-22: Apple M1 Pro (arm64), 32 GB, macOS 27.2, `uv` 0.13.9.

## Gate

```
$ uv run --project python python python/spikes/s0_check_env.py
python 3.13.18 arm64 macOS 27.2
mlx-spatial 0.0.3: 84 of 84 submodules imported
mlx 0.32.4
torch 2.15.0
opencv-contrib-python 5.1.0.95
numpy 2.5.5
pillow 13.0.0
pillow-heif 1.8.1
mlx default device: Device(gpu, 0)
torch.backends.mps.is_available(): True
cv2.aruco DICT_4X4_50 markers: 50
S0 gate: PASS
$ echo $?
0
```

The script exits 1 when `mlx_spatial` or any of its submodules fails to import, or when one of the runtime dependencies `mlx-spatial` imports only inside functions (`scipy.ndimage`, `xatlas`, `fast_simplification`) fails to import, or when `MapAnythingScenePipeline`, `Trellis2InferencePipeline` or `Sam3dInferencePipeline` is missing from the top-level package. This was checked with a fake `mlx_spatial` package holding one broken submodule on `PYTHONPATH`: 4 failures printed, exit 1. Failures of the other packages are printed and do not change the exit code.

## `mlx-spatial`

- On PyPI as `mlx-spatial` (import name `mlx_spatial`), version 0.0.3, a pure-Python wheel of 425 kB uploaded 2026-06-14. Source: `https://github.com/appautomaton/mlx-spatial`. No source install was needed, so no commit is pinned; `uv.lock` pins the wheel hash.
- It requires Python `>=3.13,<3.14`. This is why the project pins `requires-python = "==3.13.*"`; the system Python 3.15 cannot run it.
- Its dependencies: `mlx`, `numpy`, `pillow>=12.2.0`, `scipy>=1.17.1`, `safetensors`, `pyyaml`, `xatlas`, `fast-simplification`. It does not depend on `torch`.
- 0.0.3 contains the pipelines the plan names: MapAnything (S1), TRELLIS.2 with RMBG 2 background removal and DINOv3 conditioning (S2), and SAM 3D Objects (S2). It also contains HY-WorldMirror 2, LiTo and Pixal3D.
- Console scripts installed in the env: `mlx-spatial-mapanything`, `mlx-spatial-trellis2`, `mlx-spatial-sam3d`, `mlx-spatial-hyworld2`, `mlx-spatial-lito`, `mlx-spatial-pixal3d`. `--help` exits 0 for the first three.

## Versions

| Package | Version | Note |
|---|---|---|
| CPython | 3.13.18 | downloaded by `uv` to `~/.local/share/uv/python` |
| `mlx-spatial` | 0.0.3 | |
| `mlx` / `mlx-metal` | 0.32.4 | default device is the GPU |
| `torch` | 2.15.0 | MPS available |
| `opencv-contrib-python` | 5.1.0.95 | `cv2.aruco` present; the only OpenCV build in the lock |
| `numpy` | 2.5.5 | |
| `scipy` | 1.18.1 | |
| `pillow` | 13.0.0 | |
| `pillow-heif` | 1.8.1 | libheif 1.23.6; `register_heif_opener()` works |
| `safetensors` | 0.8.0 | |
| `xatlas` | 0.0.11 | |
| `fast-simplification` | 0.2.0 | |

All 22 packages installed on this machine came as prebuilt arm64 or pure-Python wheels. Nothing was compiled.

## Install commands

```
# python/pyproject.toml written by hand: requires-python "==3.13.*", [tool.uv] package = false
uv add --project python mlx-spatial
uv add --project python mlx
uv add --project python numpy
uv add --project python pillow
uv add --project python pillow-heif
uv add --project python opencv-contrib-python
uv add --project python torch
```

To rebuild the env from the committed lock: `uv sync --project python --frozen`. A new env built this way from the warm cache, offline, took 16 s including the gate run, and the gate passed in it.

## Size on disk

| Path | Size |
|---|---|
| `python/.venv` | 1.1 GB |
| `python/.venv` with `mlx-spatial` only | 350 MB |
| `~/.cache/uv` | 1.1 GB |
| `~/.local/share/uv/python` (CPython 3.13.18) | 71 MB |

Largest packages in the env: `torch` 594 MB, `mlx` 239 MB, `cv2` 95 MB, `scipy` 72 MB.

## Time taken

The uv cache was empty at the start. Nearly all the time was download, on a connection that gave about 100–170 kB/s on the large wheels. Resolve and install steps took under 10 s each.

| Step | Wall time | Largest download |
|---|---|---|
| `uv add mlx-spatial` (also downloads CPython 3.13.18 and creates the env) | 10 min 11 s | `mlx-metal` 74.5 MiB |
| `uv add mlx`, `numpy`, `pillow` | under 1 s each | none; already installed as `mlx-spatial` dependencies |
| `uv add pillow-heif` | under 1 s, as `uv` reported it | 4.1 MiB |
| `uv add opencv-contrib-python` | 3 min 48 s | 32.9 MiB |
| `uv add torch` | 21 min 11 s | `torch` 132.1 MiB |

Total download is about 300 MiB. Import of all 84 `mlx_spatial` submodules takes 0.3 s.

## Workarounds and things to know

- None were needed for the install.
- The first `uv add torch` failed after 4 min 38 s on a DNS error from the network. `uv` left `torch` out of `pyproject.toml`; the same command passed on the second run.
- `uv` chose the `mlx-metal` wheel tagged `macosx_26_0_arm64` (78 MB). PyPI also has `macosx_14_0` and `macosx_15_0` wheels (45 MB each), so macOS 26 is not a minimum.
- `uv.lock` lists `nvidia-*`, `cuda-*` and `triton` packages. They are `torch` dependencies for Linux; the lock is cross-platform. None of them installs on macOS.
- `python/pyproject.toml` has no `[build-system]` and sets `package = false`, so `uv` installs the dependencies only and does not try to build the project itself.

## For the later spikes

- S1 and S2 can share this env, as the plan hoped. `torch` with MPS is there for VGGT, MASt3R-SfM and SAM 2.1, which `mlx-spatial` does not cover.
- No weights were downloaded. `mlx-spatial` never ships weights; its README expects them in a `weights/` folder (`weights/map-anything/`, `weights/trellis2/`, `weights/rmbg2/`, `weights/dinov3-vitl16-pretrain-lvd1689m/`, `weights/sam-3d-objects-mlx/`). Each CLI has a `download-command` subcommand that prints an `hf download` command and a `validate` subcommand.
- The `hf` command (`huggingface_hub`) is not a dependency of `mlx-spatial` 0.0.3 and is not in this env. The spike that downloads weights first adds it.
- The package's own messages say SAM 3D Objects checkpoints are gated on Hugging Face (`sam3d_assets.py`) and carry a DINOv3 access note (`DINOv3_ACCESS_NOTE`), so S2 needs a signed-in `hf` account.
- At the download speed seen here, multi-gigabyte weights will take hours. The Settings install job needs a resumable download and a visible progress line.
