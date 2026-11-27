import json
from pathlib import Path

import numpy as np


def save_scene(*, out_dir: Path, names, images, world_points, confidence, masks, camera_poses, intrinsics, transforms, extra):
    """Write `scene.npz` (per-view points, confidence, mask, image, camera-to-world pose, intrinsics, JPEG-to-grid transform) and `run.json`."""
    out_dir.mkdir(parents=True, exist_ok=True)
    images = np.asarray(images)
    if images.dtype != np.uint8:
        images = np.clip(images * 255 if images.max() <= 1.0 else images, 0, 255).astype(np.uint8)
    np.savez_compressed(
        out_dir / "scene.npz",
        names=np.array(names),
        images=images,
        world_points=np.asarray(world_points, dtype=np.float32),
        confidence=np.asarray(confidence, dtype=np.float32),
        masks=np.asarray(masks).astype(bool),
        camera_poses=np.asarray(camera_poses, dtype=np.float32),
        intrinsics=np.asarray(intrinsics, dtype=np.float32),
        transforms=np.asarray(transforms, dtype=np.float64),
    )
    (out_dir / "run.json").write_text(json.dumps(extra, indent=2))
