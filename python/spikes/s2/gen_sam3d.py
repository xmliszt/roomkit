"""Generate one textured GLB with SAM 3D Objects (mlx-spatial) from photo + mask and write raw.glb plus metrics.json."""

import argparse
import json
import os
import resource
import time

import mlx.core as mx
import numpy as np
from PIL import Image

from mlx_spatial import sam3d_inference
from mlx_spatial.sam3d_inference import Sam3dInferencePipeline
from paths import PRODUCTS, S3_SETS, SPIKE, WEIGHTS, input_by_id, output_dir

parser = argparse.ArgumentParser()
parser.add_argument("input_id")
parser.add_argument("--texture-size", type=int, default=1024)
parser.add_argument("--target-faces", type=int, default=150_000)
parser.add_argument("--memory-profile", default="balanced")
parser.add_argument("--long-side", type=int, default=1536)
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--variant", default="sam3d")
args = parser.parse_args()

spec = input_by_id(args.input_id)
if spec["kind"] == "in-room":
    image, mask = S3_SETS / spec["id"] / "photo.jpg", S3_SETS / spec["id"] / "mask.png"
else:
    stem = spec["image"].removesuffix(".jpg")
    image, mask = PRODUCTS / spec["image"], PRODUCTS / "masks" / f"{stem}.png"
out = output_dir(args.variant, spec["id"])
out.mkdir(parents=True, exist_ok=True)
os.chdir(SPIKE)
photo = Image.open(image)
if max(photo.size) > args.long_side:
    size = tuple(round(side * args.long_side / max(photo.size)) for side in photo.size)
    photo.convert("RGB").resize(size, Image.LANCZOS).save(out / "input.jpg", quality=95)
    Image.open(mask).convert("L").resize(size, Image.NEAREST).save(out / "input-mask.png")
    image, mask = out / "input.jpg", out / "input-mask.png"

start = time.perf_counter()
stages = []
original_release = sam3d_inference._release_mlx_stage_memory
original_ss_decoder = sam3d_inference.run_sam3d_ss_decoder


def timed_release(metadata, label, *rest, **kwargs):
    stages.append({"stage": label, "atS": round(time.perf_counter() - start, 2), "mlxActiveGb": round(mx.get_active_memory() / 1e9, 2)})
    print(f"  {stages[-1]['atS']:7.1f} s  {label}  mlx peak {mx.get_peak_memory() / 1e9:.1f} GB", flush=True)
    return original_release(metadata, label, *rest, **kwargs)


def saving_ss_decoder(*rest, **kwargs):
    decoded = original_ss_decoder(*rest, **kwargs)
    np.save(out / "coarse-coords.npy", np.array(decoded.coords))
    stages.append({"stage": "ss-decoded", "atS": round(time.perf_counter() - start, 2), "coords": int(decoded.coords.shape[0])})
    return decoded


large_mesh_guard = sam3d_inference._mesh_memory_config("large")
# The balanced guard is checked against a worst-case estimate that counts every 256^3 cube as surface (44 GB),
# before the real surface cubes (1.1-2.0 GB on the product runs) are known.
sam3d_inference._mesh_memory_config = lambda memory_profile: large_mesh_guard
sam3d_inference._release_mlx_stage_memory = timed_release
sam3d_inference.run_sam3d_ss_decoder = saving_ss_decoder
mx.reset_peak_memory()
root = WEIGHTS / "sam-3d-objects-mlx"
result = Sam3dInferencePipeline(root).generate_gaussians_ply(
    image,
    mask_path=mask,
    output_path=out / "gaussians.ply",
    glb_output_path=out / "raw.glb",
    moge_root=root / "moge",
    seed=args.seed,
    memory_profile=args.memory_profile,
    glb_target_faces=args.target_faces,
    glb_texture_size=args.texture_size,
)
total = time.perf_counter() - start
trace = result.trace


def find_key(value, key):
    if isinstance(value, dict):
        if key in value:
            return value[key]
        return next((found for item in value.values() if (found := find_key(item, key)) is not None), None)
    return None


metrics = {
    "model": "sam3d",
    "input": spec["id"],
    "image": str(image),
    "mask": str(mask),
    "settings": {
        "textureSize": args.texture_size,
        "targetFaces": args.target_faces,
        "memoryProfile": args.memory_profile,
        "meshGuard": "large",
        "inputSizePx": list(Image.open(image).size),
        "seed": args.seed,
    },
    "ok": trace.blocker is None and (out / "raw.glb").is_file(),
    "totalS": round(total, 1),
    "peakRssGb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2),
    "peakGpuGb": round(mx.get_peak_memory() / 1e9, 2),
    "stages": stages,
    "completed": list(trace.completed_stages),
    "surfaceCubeCount": find_key(getattr(trace, "metadata", None), "surface_cube_count"),
    "flexicubesEstimate": find_key(getattr(trace, "metadata", None), "estimated_flexicubes_bytes"),
    "pose": trace.metadata.get("sparse_structure", {}).get("pose") if hasattr(trace, "metadata") else None,
    "blocker": None if trace.blocker is None else {
        "stage": trace.blocker.stage,
        "operation": trace.blocker.operation,
        "reason": trace.blocker.reason,
    },
}
(out / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
print(json.dumps({k: metrics[k] for k in ("input", "ok", "totalS", "peakRssGb", "peakGpuGb", "blocker")}))
raise SystemExit(0 if metrics["ok"] else 1)
