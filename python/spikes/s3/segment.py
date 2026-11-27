import os
import pathlib

import numpy as np
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

OUT = pathlib.Path.home() / ".cache/interior-planner-spikes/s3"


def load_photo(name):
    """Return the photo as an RGB image with EXIF orientation applied."""
    photos = os.environ.get("PLANNER_SPIKE_PHOTOS")
    if not photos:
        raise ValueError("Set PLANNER_SPIKE_PHOTOS to the room photos directory.")
    return ImageOps.exif_transpose(Image.open(pathlib.Path(photos) / name)).convert("RGB")


def share_in_box(mask, box):
    """Return the share of `mask` pixels that lie inside `box`."""
    x0, y0, x1, y1 = box
    return mask[y0:y1, x0:x1].sum() / max(1, mask.sum())


def slug(text):
    return text.replace(" ", "_")


def save_overlay(image, mask, box, path):
    """Save the photo cropped to `box` plus a margin, with the mask tinted and the box drawn."""
    from PIL import ImageDraw

    arr = np.asarray(image).copy()
    arr[mask] = (arr[mask] * 0.45 + np.array([255, 40, 160]) * 0.55).astype(np.uint8)
    out = Image.fromarray(arr)
    ImageDraw.Draw(out).rectangle(box, outline=(0, 255, 0), width=max(4, image.width // 600))
    x0, y0, x1, y1 = box
    mx, my = (x1 - x0) * 0.1, (y1 - y0) * 0.1
    out = out.crop((max(0, x0 - mx), max(0, y0 - my), min(image.width, x1 + mx), min(image.height, y1 + my)))
    out.thumbnail((1200, 1200))
    out.save(path, quality=88)
