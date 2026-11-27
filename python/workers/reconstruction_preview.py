import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np
from PIL import Image


def write_preview(*, scene, photos, photos_dir, output_path):
    records = {photo["photoId"]: photo for photo in photos if photo["kind"] == "accepted"}
    samples = []
    for index, name in enumerate(scene["names"]):
        photo = records.get(str(name))
        if photo is None:
            continue
        points = scene["world_points"][index]
        height, width = points.shape[:2]
        scale, left, top = scene["transforms"][index]
        source_width, source_height = scene["image_sizes"][index]
        if not np.isfinite([scale, left, top, source_width, source_height]).all() or scale <= 0 or min(source_width, source_height) <= 0:
            raise ValueError("Reconstruction has an invalid photo transform")
        with Image.open(photos_dir / photo["visionPath"]) as image:
            colors = np.asarray(image.convert("RGB"))
        ys, xs = np.mgrid[:height, :width]
        photo_x = np.rint((xs + left) / scale * colors.shape[1] / source_width).astype(int)
        photo_y = np.rint((ys + top) / scale * colors.shape[0] / source_height).astype(int)
        valid = scene["masks"][index] & np.isfinite(points).all(axis=-1) & (photo_x >= 0) & (photo_x < colors.shape[1]) & (photo_y >= 0) & (photo_y < colors.shape[0])
        if not valid.any():
            continue
        samples.append(np.concatenate((points[valid], colors[photo_y[valid], photo_x[valid]] / 255), axis=1))
    if not samples:
        return False
    combined = np.concatenate(samples)
    selected = combined[np.floor(np.arange(8000) * len(combined) / 8000).astype(int)].astype("<f4")
    descriptor, temporary = tempfile.mkstemp(dir=output_path.parent, prefix=".points-")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(selected.tobytes())
        os.replace(temporary, output_path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return True


if __name__ == "__main__":
    scene_path, photos_path, output_path = map(Path, sys.argv[1:])
    with np.load(scene_path, allow_pickle=False) as scene:
        write_preview(scene=scene, photos=json.loads(photos_path.read_text())["photos"], photos_dir=photos_path.parent, output_path=output_path)
