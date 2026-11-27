import gc
import math
import re
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from protocol import emit, run_worker, write_json


def load_backend(*, model, weights_dir):
    if model == "sam3":
        from sam3 import load
        return load(weights_dir / "sam3-mlx-bf16")
    from sam21 import load
    return load(weights_dir / "sam2.1-hiera-large")


def validate_mask(*, mask, score, image):
    if mask.shape != (image.height, image.width) or mask.dtype != np.bool_ or not mask.any():
        raise ValueError("model returned an empty or invalid mask")
    if not math.isfinite(score):
        raise ValueError("model returned a non-finite score")


def run(request):
    objects = request["objects"]
    if not isinstance(objects, list) or not objects:
        raise ValueError("objects must be a non-empty list")
    preferred = request.get("model", "sam3")
    if preferred not in ("sam3", "sam2.1"):
        raise ValueError("model must be sam3 or sam2.1")
    weights_dir = Path(request["weightsDir"])
    output = Path(request["outputDir"])
    keys = set()
    source_paths = set()
    for obj in objects:
        object_id = obj["objectId"]
        if not isinstance(object_id, str) or object_id == "__proto__" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", object_id) or object_id in keys:
            raise ValueError("objectId values must be unique safe identifiers")
        keys.add(object_id)
        if not isinstance(obj["name"], str) or not obj["name"].strip() or not obj["views"]:
            raise ValueError("each object needs a name and views")
        photo_ids = set()
        for view in obj["views"]:
            photo_id = view["photoId"]
            if not isinstance(photo_id, str) or photo_id == "__proto__" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", photo_id) or photo_id in photo_ids:
                raise ValueError("photoId values must be unique safe identifiers per object")
            photo_ids.add(photo_id)
            box = view["box"]
            if not isinstance(box, list) or len(box) != 4 or any(type(value) is not int for value in box):
                raise ValueError("box must contain four integer pixel coordinates")
            source_paths.add(Path(view["path"]).resolve())
    destinations = [output / "masks.json"] + [output / obj["objectId"] / f"{view['photoId']}.png" for obj in objects for view in obj["views"]]
    if any(path.resolve() in source_paths for path in destinations):
        raise ValueError("output must not overwrite a source photo")
    register_heif_opener()
    backend = None
    active_model = preferred
    fallback_reason = None
    results = []
    completed = 0
    total = sum(len(obj["views"]) for obj in objects)
    for obj in objects:
        views = []
        for view in obj["views"]:
            with Image.open(view["path"]) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
            box = view["box"]
            if not (0 <= box[0] < box[2] <= image.width and 0 <= box[1] < box[3] <= image.height):
                raise ValueError("box must lie inside the upright photo")
            try:
                if backend is None:
                    backend = load_backend(model=active_model, weights_dir=weights_dir)
                started = time.perf_counter()
                mask, score = backend(image=image, box=box, name=obj["name"])
                validate_mask(mask=mask, score=score, image=image)
            except Exception as error:
                if active_model != "sam3":
                    raise
                fallback_reason = str(error)
                backend = None
            if backend is None:
                gc.collect()
                if "mlx.core" in sys.modules:
                    sys.modules["mlx.core"].clear_cache()
                active_model = "sam2.1"
                emit({"kind": "progress", "stage": "fallback", "progress": completed / total, "model": active_model, "message": fallback_reason})
                backend = load_backend(model=active_model, weights_dir=weights_dir)
                started = time.perf_counter()
                mask, score = backend(image=image, box=box, name=obj["name"])
                validate_mask(mask=mask, score=score, image=image)
            duration = time.perf_counter() - started
            relative = f"{obj['objectId']}/{view['photoId']}.png"
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(mask.astype(np.uint8) * 255).save(path)
            x0, y0, x1, y1 = box
            result = {
                "photoId": view["photoId"], "maskPath": relative,
                "widthPx": image.width, "heightPx": image.height,
                "model": active_model, "score": float(score), "durationSeconds": duration,
                "shareInBox": float(mask[y0:y1, x0:x1].sum() / mask.sum()),
            }
            if fallback_reason is not None:
                result["fallbackReason"] = fallback_reason
            views.append(result)
            completed += 1
            emit({"kind": "progress", "stage": "segment", "progress": completed / total, "objectId": obj["objectId"], "photoId": view["photoId"]})
        results.append({"objectId": obj["objectId"], "name": obj["name"], "views": views})
    write_json(output / "masks.json", {"version": 1, "objects": results})
    return {"objects": results}


if __name__ == "__main__":
    run_worker(run)
