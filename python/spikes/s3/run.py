"""S3 gate: the chosen model (`MODEL`) turns every box in boxes.json into a mask in under 30 s warm, and writes the S2 inputs."""

import json
import pathlib
import resource
import sys
import time

import numpy as np
from PIL import Image

from segment import OUT, load_photo, save_overlay, share_in_box, slug

HERE = pathlib.Path(__file__).resolve().parent
MODEL = "sam3"
MODEL_OUT = OUT if MODEL == "sam3" else OUT / MODEL
S2_OBJECTS = ["sofa", "fridge", "coffee table", "floor lamp", "guitar"]
MAX_SECONDS = 30.0
GATE_MIN_SHARE_IN_BOX = 0.8
MIN_COMPONENT_SHARE = 0.01


def fill_for_s2(mask):
    """Return `mask` with enclosed holes filled and components under `MIN_COMPONENT_SHARE` of its area removed."""
    from scipy import ndimage

    labels, count = ndimage.label(mask)
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    kept = np.isin(labels, 1 + np.flatnonzero(sizes >= MIN_COMPONENT_SHARE * mask.sum()))
    return ndimage.binary_fill_holes(kept)


def save_s2_set(image, mask, name):
    mask = fill_for_s2(mask)
    folder = MODEL_OUT / "s2" / slug(name)
    folder.mkdir(parents=True, exist_ok=True)
    image.save(folder / "photo.jpg", quality=95)
    Image.fromarray(mask.astype(np.uint8) * 255).save(folder / "mask.png")
    ys, xs = np.nonzero(mask)
    rgba = np.dstack([np.asarray(image), mask.astype(np.uint8) * 255])
    Image.fromarray(rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], "RGBA").save(folder / "crop.png")
    return folder


def load_segmenter():
    """Load `MODEL` and return its name, a function from (image, entry) to (mask, score, seconds), and a function that reads its accelerator memory in GB."""
    if MODEL == "sam3":
        import mlx.core as mx

        from segment_sam3 import load_sam3, segment_sam3

        model, processor = load_sam3()
        return (
            "sam3-bf16 (mlx-community) on mlx",
            lambda image, entry: segment_sam3(model, processor, image, entry["box"], entry["object"]),
            lambda: mx.get_peak_memory() / 1e9,
        )
    if MODEL != "sam2.1":
        raise ValueError(f"unknown MODEL {MODEL!r}")
    import torch

    from segment_sam21 import load_model, segment

    processor, model = load_model("mps")

    def run(image, entry):
        mask, score, encode_s, decode_s = segment(processor, model, "mps", image, entry["box"])
        return mask, score, encode_s + decode_s

    return "sam2.1-hiera-large on mps", run, lambda: torch.mps.driver_allocated_memory() / 1e9


def main():
    boxes = json.loads((HERE / "boxes.json").read_text())
    (MODEL_OUT / "masks").mkdir(parents=True, exist_ok=True)
    (MODEL_OUT / "overlays").mkdir(parents=True, exist_ok=True)

    start = time.perf_counter()
    label, run, accelerator_gb = load_segmenter()
    run(load_photo(boxes[0]["photo"]), boxes[0])
    print(f"model: {label}, load and first mask {time.perf_counter() - start:.1f} s")

    failures = []
    peak_accelerator_gb = 0.0
    for entry in boxes:
        image = load_photo(entry["photo"])
        mask, score, total_s = run(image, entry)
        peak_accelerator_gb = max(peak_accelerator_gb, accelerator_gb())
        name = f"{slug(entry['object'])}_{pathlib.Path(entry['photo']).stem}"
        Image.fromarray(mask.astype(np.uint8) * 255).save(MODEL_OUT / "masks" / f"{name}.png")
        save_overlay(image, mask, entry["box"], MODEL_OUT / "overlays" / f"{name}.jpg")
        inside = share_in_box(mask, entry["box"])
        print(
            f"{entry['object']:<13} {entry['photo']}  {total_s:5.2f} s per mask  score {score:.2f}"
            f"  area {mask.mean():.1%}  in box {inside:.0%}"
        )
        if mask.shape != (image.height, image.width):
            failures.append(f"{name}: mask {mask.shape} is not the photo size")
        if not mask.any():
            failures.append(f"{name}: empty mask")
        elif inside < GATE_MIN_SHARE_IN_BOX:
            failures.append(f"{name}: only {inside:.0%} of the mask is inside the box")
        if total_s >= MAX_SECONDS:
            failures.append(f"{name}: {total_s:.1f} s per mask")
        if entry["object"] in S2_OBJECTS and mask.any():
            print(f"  S2 set: {save_s2_set(image, mask, entry['object'])}")

    missing = set(S2_OBJECTS) - {entry["object"] for entry in boxes}
    failures.extend(f"{name}: no box for an S2 set" for name in sorted(missing))
    rss_gb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9
    print(f"peak RSS {rss_gb:.1f} GB, peak accelerator memory {peak_accelerator_gb:.1f} GB")
    for failure in failures:
        print(f"FAIL {failure}")
    print("S3 gate: FAIL" if failures else "S3 gate: PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
