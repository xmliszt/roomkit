import contextlib
import gc
import importlib
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time
import uuid

import numpy as np
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from protocol import UserFacingError, emit, write_json


def prepare_image(*, request, directory):
    register_heif_opener()
    with Image.open(request["photoPath"]) as source:
        photo = ImageOps.exif_transpose(source).convert("RGBA")
    mask = None
    if request.get("maskPath") is not None:
        with Image.open(request["maskPath"]) as source:
            mask = source.convert("L")
        if mask.size != photo.size:
            raise ValueError("maskPath must match the upright photo dimensions")
        mask = mask.point(lambda value: 255 if value >= 128 else 0)
        if mask.getbbox() is None:
            raise ValueError("maskPath contains no foreground pixels")
    if max(photo.size) > 1536:
        size = tuple(max(1, round(side * 1536 / max(photo.size))) for side in photo.size)
        photo = photo.resize(size, Image.Resampling.LANCZOS)
        if mask is not None:
            mask = mask.resize(size, Image.Resampling.NEAREST)
            if mask.getbbox() is None:
                raise ValueError("maskPath has no foreground after resizing")
    photo_path = directory / "photo.png"
    photo.save(photo_path)
    mask_path = None
    if mask is not None:
        mask_path = directory / "mask.png"
        mask.save(mask_path)
    return photo_path, mask_path


def segment_reference(*, photo_path, name, weights, directory, mx):
    with Image.open(photo_path) as source:
        image = source.convert("RGB")
    prompt = name.split("(")[0].strip() or name
    mask, score = None, 0.0
    if not (weights / "sam3-mlx-bf16").is_dir():
        print("SAM 3 is not installed; using RMBG-2.0", file=sys.stderr)
    else:
        try:
            from sam3 import load

            predict = load(weights / "sam3-mlx-bf16")
            mask, score = predict(image=image, box=None, name=prompt)
            del predict
        except Exception as error:
            print(f"SAM 3 found no mask for {prompt!r}: {error}", file=sys.stderr)
    gc.collect()
    mx.clear_cache()
    source = "sam3"
    if mask is None or score < 0.5 or not 0.002 <= mask.mean() <= 0.9:
        full_frame = mask if mask is not None and score >= 0.5 and mask.mean() > 0.9 else None
        if mask is not None:
            print(f"SAM 3 mask for {prompt!r} rejected; using RMBG-2.0", file=sys.stderr)
        from mlx_spatial.trellis2_rmbg_forward import remove_background_rmbg2_mlx

        rgba = remove_background_rmbg2_mlx(image, root=weights / "rmbg2")
        mask = np.asarray(rgba.getchannel("A")) >= 128
        source = "rmbg2"
        gc.collect()
        mx.clear_cache()
        if mask.mean() < 0.002 and full_frame is not None:
            mask, source = full_frame, "sam3"
    if mask.mean() < 0.002:
        raise UserFacingError(f"Could not find the {prompt} in the reference photo")
    mask_path = directory / "mask.png"
    Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path)
    return mask_path, source


@contextlib.contextmanager
def report_steps(*, targets, report):
    """Patch each `(module, function)` in `targets` so every call reports one sampler step, restoring them on exit."""
    originals = []
    try:
        for module_name, attribute in targets:
            module = importlib.import_module(module_name)
            original = getattr(module, attribute)
            originals.append((module, attribute, original))

            def step(*args, _original=original, **kwargs):
                report(None)
                return _original(*args, **kwargs)

            setattr(module, attribute, step)
        yield
    finally:
        for module, attribute, original in originals:
            setattr(module, attribute, original)


def create_stage_clock():
    """Return a `report(stage)` callback and a `finish()` that returns `stageSeconds`, `maxSilentSeconds` and `sampleSteps`."""
    clock = {"stageMark": time.perf_counter(), "lastReport": time.perf_counter(), "maxSilent": 0.0, "steps": 0}
    durations = {}

    def report(stage):
        now = time.perf_counter()
        clock["maxSilent"] = max(clock["maxSilent"], now - clock["lastReport"])
        clock["lastReport"] = now
        if stage is None:
            clock["steps"] += 1
            emit({"kind": "progress", "stage": "sampling", "step": clock["steps"]})
            return
        durations[stage] = durations.get(stage, 0) + now - clock["stageMark"]
        clock["stageMark"] = now
        emit({"kind": "progress", "stage": stage})

    def finish():
        now = time.perf_counter()
        return {
            "stageSeconds": {stage: round(seconds, 1) for stage, seconds in durations.items()},
            "maxSilentSeconds": round(max(clock["maxSilent"], now - clock["lastReport"]), 1),
            "sampleSteps": clock["steps"],
        }

    return report, finish


def read_swap_used_mb():
    if sys.platform != "darwin":
        return None
    output = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True, check=False).stdout
    parts = output.split()
    return float(parts[parts.index("used") + 2].rstrip("M")) if "used" in parts else None


def save_crop(*, photo_path, mask_path, output_path):
    with Image.open(photo_path) as source, Image.open(mask_path) as mask_source:
        photo = source.convert("RGBA")
        mask = mask_source.convert("L")
        bounds = mask.getbbox()
        if bounds is None:
            raise ValueError("mask contains no foreground pixels")
        photo.putalpha(mask)
        crop = photo.crop(bounds)
        padded = Image.new("RGBA", (crop.width + 2, crop.height + 2))
        padded.paste(crop, (1, 1))
        padded.save(output_path)
    return output_path


def run_generation(*, request, model, generate):
    started = time.perf_counter()
    weights = Path(request["weightsDir"]).resolve(strict=True)
    output = Path(request["outputDir"]).resolve()
    sources = {Path(request[key]).resolve() for key in ("photoPath", "maskPath") if request.get(key) is not None}
    if (output / "metrics.json").resolve() in sources:
        raise ValueError("outputDir must not overwrite the source photo or mask")
    name = request.get("name")
    if request.get("maskPath") is None and (not isinstance(name, str) or not name.strip()):
        raise UserFacingError("Name the item so it can be found in the reference photo")
    output.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HUB_OFFLINE"] = "1"
    import mlx.core as mx

    mx.reset_peak_memory()
    swap_before_mb = read_swap_used_mb()
    report, finish = create_stage_clock()
    published = output / f"run-{uuid.uuid4()}"
    with tempfile.TemporaryDirectory(prefix=".generate-", dir=output) as temporary:
        directory = Path(temporary)
        photo_path, mask_path = prepare_image(request=request, directory=directory)
        report("prepare")
        mask_source = "given"
        if mask_path is None:
            mask_path, mask_source = segment_reference(
                photo_path=photo_path, name=name, weights=weights, directory=directory, mx=mx,
            )
            report("segmenting")
        (directory / "outputs").mkdir()
        with contextlib.chdir(directory):
            result = generate(weights=weights, directory=directory, photo_path=photo_path, mask_path=mask_path, report=report)
        blocker = result.trace.blocker
        if blocker is not None:
            raise RuntimeError(f"{blocker.stage}: {blocker.operation}: {blocker.reason}")
        glb = directory / "outputs/model.glb"
        if not glb.is_file() or glb.stat().st_size == 0:
            raise RuntimeError(f"{model} produced no GLB")
        peak_rss_gb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1e9 if sys.platform == "darwin" else 1e6)
        mlx_peak_gb = mx.get_peak_memory() / 1e9
        timing = finish()
        swap_after_mb = read_swap_used_mb()
        metrics = {
            "glbPath": str(published / "model.glb"),
            "sourceUp": "+Z", "sourceFront": "-Y",
            "model": model,
            "maskSource": mask_source,
            "durationSeconds": time.perf_counter() - started,
            **timing,
            "peakRssGb": peak_rss_gb, "mlxPeakGb": mlx_peak_gb,
            "peakMemoryGb": max(peak_rss_gb, mlx_peak_gb),
            "swapUsedMb": {"before": swap_before_mb, "after": swap_after_mb},
        }
        os.replace(directory / "outputs", published)
        write_json(output / "metrics.json", metrics)
    emit({"kind": "progress", "stage": "complete", "progress": 1})
    return metrics
