"""Generate one textured GLB with Hunyuan3D 2.1 (shape + PBR paint) through the community MPS port.

Run from the s2 folder with the hunyuan env:
  python/spikes/s2/hunyuan/.venv/bin/python python/spikes/s2/hunyuan/gen_hunyuan.py <input_id>
The port lives outside the repo at ~/.cache/interior-planner-spikes/s2/src/hy21mac.
"""

import argparse
import json
import resource
import shutil
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import PRODUCTS, S3_SETS, SPIKE, WEIGHTS, input_by_id, output_dir

PORT = SPIKE / "src" / "hy21mac"
sys.path[:0] = [str(PORT), str(PORT / "Hunyuan3D-2.1" / "hy3dshape"), str(PORT / "Hunyuan3D-2.1" / "hy3dpaint"), str(PORT / "Hunyuan3D-2.1")]

import backend as backend_mod  # sets the MPS environment before torch loads
import compat_patches
import torch
import transformers
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("input_id")
parser.add_argument("--steps", type=int, default=30)
parser.add_argument("--octree", type=int, default=256)
parser.add_argument("--guidance", type=float, default=5.0)
parser.add_argument("--preset", default="safe")
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--variant", default="hunyuan21")
args = parser.parse_args()

spec = input_by_id(args.input_id)
image_path = S3_SETS / spec["id"] / "crop.png" if spec["kind"] == "in-room" else PRODUCTS / "masks" / f"{spec['image'].removesuffix('.jpg')}-rgba.png"
out = output_dir(args.variant, spec["id"])
out.mkdir(parents=True, exist_ok=True)

local_dino = str(WEIGHTS / "hunyuan3d-2.1" / "dinov2-giant")
for loader in (transformers.AutoModel, transformers.AutoImageProcessor):
    original = loader.from_pretrained.__func__

    def redirected(cls, name, *rest, _original=original, **kwargs):
        return _original(cls, local_dino if name == "facebook/dinov2-giant" else name, *rest, **kwargs)

    loader.from_pretrained = classmethod(redirected)

peak = {"mpsGb": 0.0}
running = True


def sample_memory():
    while running:
        peak["mpsGb"] = max(peak["mpsGb"], torch.mps.driver_allocated_memory() / 1e9)
        time.sleep(0.5)


threading.Thread(target=sample_memory, daemon=True).start()
stages = []
start = time.perf_counter()


def mark(stage):
    stages.append({"stage": stage, "atS": round(time.perf_counter() - start, 1)})
    print(f"  {stages[-1]['atS']:7.1f} s  {stage}  mps peak {peak['mpsGb']:.1f} GB", flush=True)


b = backend_mod.detect()
compat_patches.apply(b)
from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

compat_patches.patch_scheduler_timestep_lookup()
shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
    str(PORT / "weights" / "Hunyuan3D-2.1"), subfolder="hunyuan3d-dit-v2-1", use_safetensors=False, variant="fp16", device=b.device, dtype=b.dtype
)
shape_pipeline.to(b.device)
mark("shape-loaded")
image = Image.open(image_path).convert("RGBA")
with torch.inference_mode():
    mesh = shape_pipeline(
        image=image,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        octree_resolution=args.octree,
        generator=torch.Generator().manual_seed(args.seed),
    )[0]
mesh.export(out / "shape.glb")
mark("shape-done")
del shape_pipeline
backend_mod.empty_cache(b)

import paint
from local_paint_pipeline import LocalPaintPipeline
from patch_super_resolution import patch_super_resolution
from utils import multiview_utils

paint._patch_super_resolution = patch_super_resolution
multiview_utils.DiffusionPipeline = LocalPaintPipeline

error = None
try:
    saved = paint.texture_mesh(str(out / "shape.glb"), image, b, preset=args.preset, output_dir=str(out / "paint"))
    shutil.copy(saved["glb"], out / "raw.glb")
    mark("paint-done")
except Exception as exception:
    error = f"{type(exception).__name__}: {exception}"
running = False
total = time.perf_counter() - start
metrics = {
    "model": "hunyuan21",
    "input": spec["id"],
    "image": str(image_path),
    "settings": {"steps": args.steps, "octree": args.octree, "guidance": args.guidance, "paintPreset": args.preset, "seed": args.seed},
    "ok": error is None and (out / "raw.glb").is_file(),
    "totalS": round(total, 1),
    "peakRssGb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2),
    "peakGpuGb": round(peak["mpsGb"], 2),
    "stages": stages,
    "blocker": None if error is None else {"stage": "paint", "reason": error},
}
(out / "metrics.json").write_text(json.dumps(metrics, indent=2))
print(json.dumps({k: metrics[k] for k in ("input", "ok", "totalS", "peakRssGb", "peakGpuGb", "blocker")}))
raise SystemExit(0 if metrics["ok"] else 1)
