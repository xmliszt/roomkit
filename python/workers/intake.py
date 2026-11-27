import math
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import ExifTags, Image, ImageOps
from pillow_heif import register_heif_opener

from protocol import emit, run_worker, write_json


def valid_id(value):
    return isinstance(value, str) and value != "__proto__" and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value)


def positive_number(value):
    if value is None:
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def run(request):
    sources = request["photos"]
    if not isinstance(sources, list) or not sources:
        raise ValueError("photos must be a non-empty list")
    ids = [source["photoId"] for source in sources]
    if not all(valid_id(photo_id) for photo_id in ids) or len(set(ids)) != len(ids):
        raise ValueError("photoId values must be unique safe identifiers")
    threshold = request.get("blurThreshold", 8.0)
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or threshold < 0:
        raise ValueError("blurThreshold must be a finite non-negative number")
    output = Path(request["outputDir"])
    source_paths = {Path(source["path"]).resolve() for source in sources}
    destinations = [output / "photos.json"] + [output / folder / f"{photo_id}.jpg" for folder in ("upright", "vision") for photo_id in ids]
    if any(path.resolve() in source_paths for path in destinations):
        raise ValueError("output must not overwrite a source photo")
    register_heif_opener()
    entries = []
    for index, source in enumerate(sources):
        path = Path(source["path"])
        with Image.open(path) as original:
            exif = original.getexif()
            detail = exif.get_ifd(ExifTags.IFD.Exif)
            upright = ImageOps.exif_transpose(original).convert("RGB")
        vision = upright.copy()
        vision.thumbnail((1568, 1568), Image.Resampling.LANCZOS)
        gray = np.asarray(vision.convert("L"))
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        accepted = blur_score >= threshold
        entry = {
            "photoId": source["photoId"],
            "kind": "accepted" if accepted else "rejected",
            "sourceFileName": path.name,
            "widthPx": upright.width,
            "heightPx": upright.height,
            "orientation": int(exif.get(ExifTags.Base.Orientation, 1)),
            "blurScore": blur_score,
        }
        lens = detail.get(ExifTags.Base.LensModel)
        if lens:
            entry["lens"] = str(lens)
        focal_mm = positive_number(detail.get(ExifTags.Base.FocalLength))
        if focal_mm is not None:
            entry["focalLengthMm"] = focal_mm
        focal_35mm = positive_number(detail.get(ExifTags.Base.FocalLengthIn35mmFilm))
        if focal_35mm is not None:
            entry["focalLength35Mm"] = focal_35mm
            entry["focalLengthPx"] = focal_35mm * math.hypot(upright.width, upright.height) / 43.2666
        if accepted:
            entry.update({
                "uprightPath": f"upright/{source['photoId']}.jpg",
                "visionPath": f"vision/{source['photoId']}.jpg",
                "visionWidthPx": vision.width,
                "visionHeightPx": vision.height,
            })
            for key, image in (("uprightPath", upright), ("visionPath", vision)):
                target = output / entry[key]
                target.parent.mkdir(parents=True, exist_ok=True)
                image.save(target, quality=92, exif=b"")
        else:
            entry["reason"] = "blur"
        entries.append(entry)
        emit({"kind": "progress", "stage": "intake", "progress": (index + 1) / len(sources), "photoId": source["photoId"]})
    write_json(output / "photos.json", {"version": 1, "photos": entries})
    return {"photos": entries}


if __name__ == "__main__":
    run_worker(run)
