import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid

import numpy as np

from fit_layout import fit_layout
from mapanything import predict
from protocol import emit, run_worker, write_json
from room import align_scene, build_room
from reconstruction_preview import write_preview
from scale import resolve_scale


def run(request):
    started = time.monotonic()
    photos_path = Path(request["photosPath"])
    entries = json.loads(photos_path.read_text())["photos"]
    photos = [photo for photo in entries if photo["kind"] == "accepted"]
    if len(photos) < 2:
        raise ValueError("Reconstruction needs at least two accepted photos")
    ids = [photo["photoId"] for photo in photos]
    if any(not isinstance(identifier, str) or identifier == "__proto__" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", identifier) for identifier in ids) or len(set(ids)) != len(ids):
        raise ValueError("Accepted photo IDs must be unique safe identifiers")
    output = Path(request["outputDir"])
    output.mkdir(parents=True, exist_ok=True)
    emit({"kind": "progress", "stage": "geometry", "progress": 0.05})
    scene = predict(photos=photos, photos_dir=photos_path.parent, weights_dir=Path(request["weightsDir"]))
    emit({"kind": "progress", "stage": "layout", "progress": 0.75})
    layout = fit_layout(scene)
    scale = resolve_scale(scene=scene, layout=layout, sources=request.get("scaleSources", []))
    previous_path = output / "room.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
    previous_cameras = json.loads((output / previous["camerasPath"]).read_text()) if previous else None
    room, basis, center = build_room(scene=scene, layout=layout, factor=scale["factor"], previous=previous, previous_cameras=previous_cameras)
    aligned = align_scene(scene=scene, basis=basis, center=center, factor=scale["factor"])
    cameras = [{"photoId": str(name), "cameraToWorld": pose.tolist(), "intrinsics": intrinsic.tolist(), "visionToGrid": transform.tolist(), "visionSizePx": size.tolist()} for name, pose, intrinsic, transform, size in zip(aligned["names"], aligned["camera_poses"], aligned["intrinsics"], aligned["transforms"], aligned["image_sizes"])]
    generation = f"run-{uuid.uuid4()}"
    published = output / generation
    with tempfile.TemporaryDirectory(dir=output, prefix=".reconstruct-") as temporary:
        staging = Path(temporary)
        np.savez_compressed(staging / "scene.npz", **aligned)
        try:
            has_preview = write_preview(scene=aligned, photos=photos, photos_dir=photos_path.parent, output_path=staging / "points.bin")
        except (KeyError, OSError, ValueError) as error:
            # The point preview only animates the reveal; the room is valid without it.
            print(f"Skipped the point preview: {error}", file=sys.stderr)
            has_preview = False
        write_json(staging / "cameras.json", cameras)
        write_json(staging / "planes.json", {"modelFit": layout, "basis": basis.tolist(), "originInBasis": center.tolist(), "scaleFactor": scale["factor"]})
        os.replace(staging, published)
    result = {**room, "scale": scale, "scenePath": f"{generation}/scene.npz", "camerasPath": f"{generation}/cameras.json", "planesPath": f"{generation}/planes.json", "durationSeconds": time.monotonic() - started, "mlxPeakGb": float(scene["mlx_peak_gb"])}
    if has_preview:
        result["pointsPath"] = f"{generation}/points.bin"
    write_json(output / "room.json", result)
    emit({"kind": "progress", "stage": "reconstructed", "progress": 1})
    return result


if __name__ == "__main__":
    run_worker(run)
