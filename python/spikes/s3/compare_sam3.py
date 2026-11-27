"""S3 comparison: SAM 3 on the per-photo boxes of the 4 measured pieces, with score and mask-to-box area for each mask."""

import json
import pathlib
import resource

import mlx.core as mx

from segment import OUT, load_photo, save_overlay, slug
from segment_sam3 import load_sam3, segment_sam3

HERE = pathlib.Path(__file__).resolve().parent


def main():
    model, processor = load_sam3()
    entries = json.loads((HERE / "boxes-all-photos.json").read_text())
    folder = OUT / "sam3-all-photos"
    folder.mkdir(parents=True, exist_ok=True)
    first = load_photo(entries[0]["photo"])
    segment_sam3(model, processor, first, [0, 0, first.width, first.height], entries[0]["object"])
    for entry in entries:
        image = load_photo(entry["photo"])
        f = entry["boxFrac"]
        box = [round(f[0] * image.width), round(f[1] * image.height), round(f[2] * image.width), round(f[3] * image.height)]
        mask, score, seconds = segment_sam3(model, processor, image, box, entry["object"])
        stem = pathlib.Path(entry["photo"]).stem
        save_overlay(image, mask, box, folder / f"{slug(entry['object'])}_{stem}.jpg")
        fill = mask.sum() / ((box[2] - box[0]) * (box[3] - box[1]))
        print(f"sam3  {entry['object']:<7} {stem}  {seconds:5.2f} s  score {score:.2f}  area {mask.mean():.1%}  mask/box {fill:.2f}")
    rss_gb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9
    print(f"peak RSS {rss_gb:.1f} GB, MLX peak {mx.get_peak_memory() / 1e9:.1f} GB")


if __name__ == "__main__":
    main()
