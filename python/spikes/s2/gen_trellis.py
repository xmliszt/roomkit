"""Generate one textured GLB with TRELLIS.2 (mlx-spatial) and write raw.glb plus metrics.json."""

import argparse
import faulthandler
import json
import os
import resource
import time

import mlx.core as mx
import numpy as np

from mlx_spatial import trellis2_inference
from mlx_spatial.trellis2_inference import Trellis2InferencePipeline
from paths import PRODUCTS, S3_SETS, SPIKE, WEIGHTS, input_by_id, output_dir

parser = argparse.ArgumentParser()
parser.add_argument("input_id")
parser.add_argument("--pipeline-type", default="512")
parser.add_argument("--texture-size", type=int, default=1024)
parser.add_argument("--target-faces", type=int, default=150_000)
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--variant", default="trellis2")
args = parser.parse_args()

spec = input_by_id(args.input_id)
image = S3_SETS / spec["id"] / "crop.png" if spec["kind"] == "in-room" else PRODUCTS / spec["image"]
out = output_dir(args.variant, spec["id"])
out.mkdir(parents=True, exist_ok=True)
os.chdir(SPIKE)

faulthandler.dump_traceback_later(1100)
start = time.perf_counter()
stages = []
original_stage_output = trellis2_inference._stage_output
original_sparse_decoder = trellis2_inference.probe_sparse_structure_decoder_boundary


def log_stage(record):
    record["atS"] = round(time.perf_counter() - start, 2)
    stages.append(record)
    print(f"  {record['atS']:7.1f} s  {record['stage']} {record['name']} {record.get('shape')}  mlx peak {mx.get_peak_memory() / 1e9:.1f} GB", flush=True)


def timed_stage_output(stage, name, payload, detail, **kwargs):
    log_stage({"stage": stage, "name": name, "shape": [int(d) for d in payload.shape], "detail": detail})
    return original_stage_output(stage, name, payload, detail, **kwargs)


def saving_sparse_decoder(*rest, **kwargs):
    probe = original_sparse_decoder(*rest, **kwargs)
    if probe.coordinates is not None:
        coordinates = np.array(probe.coordinates)
        np.save(out / "coarse-coords.npy", coordinates)
        log_stage({"stage": "sparse-structure-decoding", "name": "coarse_coordinates", "shape": list(coordinates.shape)})
    return probe


trellis2_inference._stage_output = timed_stage_output
trellis2_inference.probe_sparse_structure_decoder_boundary = saving_sparse_decoder
mx.reset_peak_memory()
result = Trellis2InferencePipeline(WEIGHTS / "trellis2", rmbg_root=WEIGHTS / "rmbg2").generate_textured_glb(
    image,
    output_path=out / "raw.glb",
    dino_root=WEIGHTS / "dinov3-vitl16-pretrain-lvd1689m",
    pipeline_type=args.pipeline_type,
    seed=args.seed,
    texture_size=args.texture_size,
    glb_target_faces=args.target_faces,
    retain_trace_payloads=False,
)
total = time.perf_counter() - start
trace = result.trace
metrics = {
    "model": "trellis2",
    "input": spec["id"],
    "image": str(image),
    "settings": {
        "pipelineType": args.pipeline_type,
        "textureSize": args.texture_size,
        "targetFaces": args.target_faces,
        "seed": args.seed,
    },
    "ok": result.artifact is not None,
    "totalS": round(total, 1),
    "peakRssGb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2),
    "peakGpuGb": round(mx.get_peak_memory() / 1e9, 2),
    "stages": stages,
    "completed": list(trace.completed_stages),
    "blocker": None if trace.blocker is None else {
        "stage": trace.blocker.stage,
        "operation": trace.blocker.operation,
        "reason": trace.blocker.reason,
    },
}
(out / "metrics.json").write_text(json.dumps(metrics, indent=2))
print(json.dumps({k: metrics[k] for k in ("input", "ok", "totalS", "peakRssGb", "peakGpuGb", "blocker")}))
raise SystemExit(0 if metrics["ok"] else 1)
