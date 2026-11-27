import math

import numpy as np
from PIL import Image


def positive(value):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError("Scale measurements must be finite and positive")
    return value


def mask_points(*, scene, source):
    names = list(scene["names"])
    if source["photoId"] not in names:
        raise ValueError(f"Scale photo {source['photoId']} is not in the reconstruction")
    index = names.index(source["photoId"])
    with Image.open(source["maskPath"]) as image:
        mask = np.array(image.convert("L")) > 0
    points = scene["world_points"][index]
    height, width = points.shape[:2]
    scale, left, top = scene["transforms"][index]
    source_width, source_height = scene["image_sizes"][index]
    ys, xs = np.mgrid[:height, :width]
    mask_x = np.rint((xs + left) / scale * mask.shape[1] / source_width).astype(int)
    mask_y = np.rint((ys + top) / scale * mask.shape[0] / source_height).astype(int)
    inside = (mask_x >= 0) & (mask_x < mask.shape[1]) & (mask_y >= 0) & (mask_y < mask.shape[0])
    selected = mask[np.clip(mask_y, 0, mask.shape[0] - 1), np.clip(mask_x, 0, mask.shape[1] - 1)]
    valid = inside & selected & scene["masks"][index] & np.isfinite(points).all(axis=-1)
    if valid.sum() < 30:
        raise ValueError("Scale mask has fewer than 30 reconstructed points")
    return points[valid]


def resolve_scale(*, scene, layout, sources):
    measurements = []
    for source in sources:
        kind = source["kind"]
        axis = source.get("axis", "height")
        if kind == "measurement":
            spans = sorted(layout["sides"][f"{a}_max"]["pos"] - layout["sides"][f"{a}_min"]["pos"] for a in ("x", "y"))
            dimensions = {"height": layout["height"], "width": spans[0], "depth": spans[1]}
            if axis not in dimensions:
                raise ValueError("Measurement axis must be height, width or depth")
            measured = dimensions[axis]
        elif kind == "furniture":
            points = mask_points(scene=scene, source=source)
            up = np.array(layout["up"])
            if axis == "height":
                heights = points @ up
                bottom = layout["floor_h"] if source.get("floorStanding", False) else np.percentile(heights, 1)
                measured = float(np.percentile(heights, 99) - bottom)
            elif axis in ("width", "depth"):
                if "direction" in source:
                    direction = np.asarray(source["direction"], dtype=float)
                    if direction.shape != (3,) or not np.isfinite(direction).all() or np.linalg.norm(direction) < 1e-9:
                        raise ValueError("Furniture direction must be a finite nonzero vector")
                    direction = direction / np.linalg.norm(direction)
                    if abs(direction @ up) > 0.01:
                        raise ValueError("Furniture width/depth direction must be horizontal")
                else:
                    centered = points - points.mean(axis=0)
                    horizontal = centered - np.outer(centered @ up, up)
                    direction = np.linalg.eigh(horizontal.T @ horizontal)[1][:, -1]
                    if axis == "depth":
                        direction = np.cross(up, direction)
                distances = points @ direction
                measured = float(np.percentile(distances, 99) - np.percentile(distances, 1))
            else:
                raise ValueError("Furniture axis must be height, width or depth")
        elif kind == "distance":
            endpoints = np.asarray(source["points"], dtype=float)
            if endpoints.shape != (2, 3) or not np.isfinite(endpoints).all():
                raise ValueError("Distance needs two finite model-space points")
            measured = np.linalg.norm(endpoints[1] - endpoints[0])
            kind = "measurement"
        else:
            raise ValueError(f"Unknown scale source: {kind}")
        known = positive(source["lengthM"])
        measured = positive(measured)
        measurements.append({"kind": kind, "label": source.get("label", axis), "measured": measured, "lengthM": known, "factor": known / measured})
    if not measurements:
        return {"kind": "model", "factor": 1.0, "weak": True, "sources": [], "disagreements": []}
    selected_kind = "measurement" if any(m["kind"] == "measurement" for m in measurements) else "furniture"
    selected = [m for m in measurements if m["kind"] == selected_kind]
    factor = sum(m["measured"] * m["lengthM"] for m in selected) / sum(m["measured"] ** 2 for m in selected)
    disagreements = [m["label"] for m in measurements if abs(m["factor"] / factor - 1) > 0.05]
    return {"kind": selected_kind, "factor": factor, "weak": False, "sources": measurements, "disagreements": disagreements}
