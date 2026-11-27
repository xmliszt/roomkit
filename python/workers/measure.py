import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import ConvexHull, QhullError, cKDTree

from protocol import emit, run_worker, write_json


def read_mask(*, view, photo, masks_dir):
    path = (masks_dir / view["maskPath"]).resolve()
    if not path.is_relative_to(masks_dir.resolve()):
        raise ValueError("Mask path must stay inside the masks directory")
    with Image.open(path) as image:
        if image.size != (photo["widthPx"], photo["heightPx"]):
            raise ValueError("Mask dimensions do not match the upright photo")
        return np.array(image.convert("L")) > 0


def read_points(*, scene, view, photo, masks_dir, excluded_views=()):
    names = list(scene["names"])
    if view["photoId"] not in names:
        return np.empty((0, 3))
    index = names.index(view["photoId"])
    mask = read_mask(view=view, photo=photo, masks_dir=masks_dir)
    for other in excluded_views:
        mask &= ~read_mask(view=other, photo=photo, masks_dir=masks_dir)
    points = scene["world_points"][index]
    height, width = points.shape[:2]
    scale, left, top = scene["transforms"][index]
    source_width, source_height = scene["image_sizes"][index]
    if not np.isfinite([scale, left, top, source_width, source_height]).all() or scale <= 0 or min(source_width, source_height) <= 0:
        raise ValueError("Reconstruction has an invalid photo transform")
    ys, xs = np.mgrid[:height, :width]
    mask_x = np.rint((xs + left) / scale * mask.shape[1] / source_width).astype(int)
    mask_y = np.rint((ys + top) / scale * mask.shape[0] / source_height).astype(int)
    inside = (mask_x >= 0) & (mask_x < mask.shape[1]) & (mask_y >= 0) & (mask_y < mask.shape[0])
    selected = mask[np.clip(mask_y, 0, mask.shape[0] - 1), np.clip(mask_x, 0, mask.shape[1] - 1)]
    valid = inside & selected & scene["masks"][index] & np.isfinite(points).all(axis=-1)
    return points[valid]


def clean_view_points(points):
    if len(points) < 30:
        return np.empty((0, 3))
    voxels, inverse, counts = np.unique(np.floor(points / 0.05), axis=0, return_inverse=True, return_counts=True)
    pairs = cKDTree(voxels).query_pairs(3.0 + 1e-8, output_type="ndarray")
    graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(voxels), len(voxels)))
    _, labels = connected_components(graph, directed=False)
    largest = np.argmax(np.bincount(labels, weights=counts))
    cluster = points[labels[inverse] == largest]
    lower, upper = np.percentile(cluster, [0.5, 99.5], axis=0)
    return cluster[((cluster >= lower - 1e-8) & (cluster <= upper + 1e-8)).all(axis=1)]


def clipped_view(*, view, photo):
    box = view.get("box")
    if box is None:
        return False
    width = photo["visionWidthPx"]
    height = photo["visionHeightPx"]
    return box[0] <= 1 or box[2] >= width - 1 or box[1] <= 1 or box[3] >= height - 1


def measure_views(*, views, obj, room):
    usable = []
    failures = []
    for view, points in views:
        cleaned = clean_view_points(points)
        if len(cleaned) < 30:
            continue
        try:
            measured = measure_object(points=cleaned, obj=obj, room=room, trim_outliers=False)
        except ValueError as error:
            failures.append(str(error))
            continue
        extent = list(measured["sizeM"].values())
        if is_floor_covering(obj):
            extent[1] = max(extent[1], 0.005)
        usable.append((view, measured, extent))
    if not usable:
        raise ValueError(failures[0] if failures else "Object masks have fewer than 30 usable reconstructed points")
    if is_floor_covering(obj):
        thickness_views = [entry for entry in usable if entry[1]["sizeM"]["height"] > 1e-4]
        usable = thickness_views or usable
    preferred = [entry for entry in usable if entry[0].get("visibility") == "mostly-visible"]
    candidates = preferred or usable
    extents = np.array([entry[2] for entry in candidates])
    median = np.median(extents, axis=0)
    within_tolerance = np.abs(extents / median - 1) <= 0.25
    if is_floor_covering(obj):
        within_tolerance[:, 1] |= np.abs(extents[:, 1] - median[1]) <= 0.005
    agreed = within_tolerance.all(axis=1)
    if not agreed.any():
        raise ValueError("Object views have no measurement consensus within 25%")
    accepted = [entry for entry, keep in zip(candidates, agreed) if keep]
    accepted_median = np.median([entry[2] for entry in accepted], axis=0)
    ranked_axes = [0, 2] if is_floor_covering(obj) else [0, 1, 2]
    representative = min(accepted, key=lambda entry: (
        float(np.sum(np.abs(np.array(entry[2])[ranked_axes] / accepted_median[ranked_axes] - 1))),
        entry[0].get("photoId") != obj.get("bestPhotoId"),
        entry[0].get("photoId", ""),
    ))
    return representative[1]


def nearest_wall(*, horizontal, room, allow_open=False):
    center = np.median(horizontal, axis=0)
    walls = room["walls"]
    candidates = []
    for index, wall in enumerate(walls):
        if wall["kind"] == "open" and not allow_open:
            continue
        start = np.array([wall["startM"]["x"], wall["startM"]["z"]])
        following = walls[(index + 1) % len(walls)]["startM"]
        edge = np.array([following["x"], following["z"]]) - start
        length = np.linalg.norm(edge)
        if length <= 0 or not np.isfinite(length):
            raise ValueError("Room walls must have finite nonzero lengths")
        direction = edge / length
        closest = start + direction * np.clip((center - start) @ direction, 0, length)
        candidates.append((float(np.linalg.norm(center - closest)), index, wall, start, direction))
    if not candidates:
        raise ValueError("Measurement needs a wall that is not open")
    return min(candidates, key=lambda candidate: (candidate[0], candidate[1]))[2:]


def rectangle_axes(points):
    try:
        hull = points[ConvexHull(points).vertices]
    except QhullError as error:
        raise ValueError("Object points do not determine both width and depth") from error
    edges = np.roll(hull, -1, axis=0) - hull
    angles = np.unique(np.round(np.mod(np.arctan2(edges[:, 1], edges[:, 0]), math.pi / 2), 12))
    best = None
    for angle in angles:
        width_axis = np.array([math.cos(angle), math.sin(angle)])
        depth_axis = np.array([-width_axis[1], width_axis[0]])
        sizes = np.ptp(points @ np.column_stack([width_axis, depth_axis]), axis=0)
        candidate = (float(np.prod(sizes)), float(angle), width_axis, depth_axis, sizes)
        if best is None or candidate[:2] < best[:2]:
            best = candidate
    _, _, width_axis, depth_axis, sizes = best
    if sizes[0] < sizes[1]:
        width_axis, depth_axis = depth_axis, -width_axis
    return width_axis, depth_axis


def is_floor_covering(obj):
    phrase = re.split(r"[(,;]| - | with ", obj.get("name", ""), maxsplit=1, flags=re.IGNORECASE)[0]
    head_noun = re.findall(r"[a-z]+", phrase, re.IGNORECASE)[-1:]
    return obj["mount"] == "floor" and any(re.fullmatch(r"(?:rug|carpet|(?:door|bath|floor)?mat)s?", word, re.IGNORECASE) for word in head_noun)


def measure_object(*, points, obj, room, trim_outliers=True):
    if len(points) < 30:
        raise ValueError("Object masks have fewer than 30 reconstructed points")
    trimmed = points
    if trim_outliers:
        lower, upper = np.percentile(points, [0.5, 99.5], axis=0)
        trimmed = points[((points >= lower - 1e-8) & (points <= upper + 1e-8)).all(axis=1)]
    if len(trimmed) < 30:
        raise ValueError("Object masks have fewer than 30 usable reconstructed points")
    horizontal = trimmed[:, [0, 2]]
    mount = obj["mount"]
    footprint_axes = np.column_stack(rectangle_axes(horizontal))
    footprint_bounds = np.percentile(horizontal @ footprint_axes, [0, 100], axis=0)
    footprint_center = footprint_axes @ footprint_bounds.mean(axis=0)
    if not inside_room(center=footprint_center, room=room) and not (mount == "wall" and intersects_room_boundary(horizontal=horizontal, room=room)):
        raise ValueError("Skipped because its measured footprint centre is outside the room")
    bottom, top = np.percentile(trimmed[:, 1], [1, 99])
    if mount == "wall":
        wall, start, along = nearest_wall(horizontal=horizontal, room=room)
        normal = np.array([along[1], -along[0]])
        face = np.column_stack([-horizontal @ along, trimmed[:, 1]])
        width_axis, height_axis = rectangle_axes(face)
        if abs(width_axis[0]) < abs(width_axis[1]):
            width_axis, height_axis = height_axis, -width_axis
        if width_axis[0] < 0:
            width_axis, height_axis = -width_axis, -height_axis
        axes = np.column_stack([width_axis, height_axis])
        lower, upper = np.percentile(face @ axes, [1, 99], axis=0)
        center = axes @ ((lower + upper) / 2)
        depth = np.diff(np.percentile(horizontal @ normal, [1, 99]))[0]
        size = [upper[0] - lower[0], depth]
        bottom, top = lower[1], upper[1]
        placement = {"kind": "wall", "wallId": wall["id"], "alongM": float(-center[0] - start @ along), "heightM": float(max(0, center[1])), "rotationRad": float(math.atan2(width_axis[1], width_axis[0]))}
    elif mount in ("floor", "ceiling"):
        width_axis, depth_axis = footprint_axes[:, 0], footprint_axes[:, 1]
        _, _, along = nearest_wall(horizontal=horizontal, room=room, allow_open=True)
        inward = np.array([along[1], -along[0]])
        if depth_axis @ inward < 0:
            width_axis, depth_axis = -width_axis, -depth_axis
        axes = np.column_stack([width_axis, depth_axis])
        lower, upper = np.percentile(horizontal @ axes, [0, 100], axis=0)
        size = upper - lower
        center = axes @ ((lower + upper) / 2)
        placement = {"kind": mount, "xM": float(center[0]), "zM": float(center[1]), "rotationRad": float(math.atan2(-width_axis[1], width_axis[0]))}
        if mount == "floor":
            placement["elevationM"] = float(bottom)
        else:
            top = room["ceilingHeightM"]
    else:
        raise ValueError("Unknown object mount")
    dimensions = {"width": float(size[0]), "height": float(top - bottom), "depth": float(size[1])}
    validate_dimensions({**dimensions, "height": max(dimensions["height"], 0.005)} if is_floor_covering(obj) else dimensions)
    return {"objectId": obj["objectId"], "sizeM": dimensions, "placement": placement}


def inside_room(*, center, room):
    inside = False
    for index, wall in enumerate(room["walls"]):
        following = room["walls"][(index + 1) % len(room["walls"])]["startM"]
        start = np.array([wall["startM"]["x"], wall["startM"]["z"]])
        end = np.array([following["x"], following["z"]])
        edge = end - start
        offset = center - start
        cross = edge[0] * offset[1] - edge[1] * offset[0]
        if abs(cross) <= 1e-8 * np.linalg.norm(edge) and 0 <= offset @ edge <= edge @ edge:
            return True
        if (start[1] > center[1]) != (end[1] > center[1]):
            crossing = start[0] + (center[1] - start[1]) * edge[0] / edge[1]
            if center[0] < crossing:
                inside = not inside
    return inside


def intersects_room_boundary(*, horizontal, room):
    axes = np.column_stack(rectangle_axes(horizontal))
    lower, upper = np.percentile(horizontal @ axes, [0, 100], axis=0)
    for index, wall in enumerate(room["walls"]):
        if wall["kind"] == "open":
            continue
        following = room["walls"][(index + 1) % len(room["walls"])]["startM"]
        start = np.array([wall["startM"]["x"], wall["startM"]["z"]]) @ axes
        end = np.array([following["x"], following["z"]]) @ axes
        first, last = 0.0, 1.0
        for axis in range(2):
            delta = end[axis] - start[axis]
            if abs(delta) <= 1e-10:
                if not lower[axis] <= start[axis] <= upper[axis]:
                    last = -1
            else:
                entry, leave = sorted(((lower[axis] - start[axis]) / delta, (upper[axis] - start[axis]) / delta))
                first, last = max(first, entry), min(last, leave)
        if first <= last:
            return True
    return False


def support_bounds(*, obj, room):
    placement, size = obj["placement"], obj["sizeM"]
    if placement["kind"] == "ceiling":
        return None
    angle = placement["rotationRad"]
    if placement["kind"] == "floor":
        return {
            "center": np.array([placement["xM"], placement["zM"]]),
            "axes": np.array([[math.cos(angle), math.sin(angle)], [-math.sin(angle), math.cos(angle)]]),
            "size": np.array([size["width"], size["depth"]]),
            "bottom": placement["elevationM"],
            "top": placement["elevationM"] + size["height"],
        }
    index = next(index for index, wall in enumerate(room["walls"]) if wall["id"] == placement["wallId"])
    wall = room["walls"][index]
    following = room["walls"][(index + 1) % len(room["walls"])]["startM"]
    start = np.array([wall["startM"]["x"], wall["startM"]["z"]])
    edge = np.array([following["x"], following["z"]]) - start
    along = edge / np.linalg.norm(edge)
    inward = np.array([along[1], -along[0]])
    width = abs(math.cos(angle)) * size["width"] + abs(math.sin(angle)) * size["height"]
    height = abs(math.sin(angle)) * size["width"] + abs(math.cos(angle)) * size["height"]
    return {
        "center": start + along * placement["alongM"] + inward * size["depth"] / 2,
        "axes": np.column_stack([along, inward]),
        "size": np.array([width, size["depth"]]),
        "bottom": placement["heightM"] - height / 2,
        "top": placement["heightM"] + height / 2,
    }


def resolve_floor_support(*, objects, room, floor_covering_ids=()):
    supports = [(obj, support_bounds(obj=obj, room=room)) for obj in objects if obj["objectId"] not in floor_covering_ids]
    for obj in objects:
        placement = obj["placement"]
        if placement["kind"] != "floor":
            continue
        bottom = placement["elevationM"]
        center = np.array([placement["xM"], placement["zM"]])
        supported = bottom > 0 and any(
            support is not obj and bounds is not None and bounds["bottom"] < bottom and bounds["top"] > 0
            and abs(bottom - bounds["top"]) <= 0.12
            and (np.abs((center - bounds["center"]) @ bounds["axes"]) <= bounds["size"] / 2).all()
            for support, bounds in supports
        )
        if not supported:
            obj["sizeM"]["height"] += bottom
            placement["elevationM"] = 0.0
        if obj["objectId"] in floor_covering_ids:
            obj["sizeM"]["height"] = max(obj["sizeM"]["height"], 0.005)


def validate_dimensions(dimensions):
    if any(not math.isfinite(value) or value <= 1e-4 for value in dimensions.values()):
        raise ValueError("Object points do not determine three positive dimensions")


def run(request):
    masks_path = Path(request["masksPath"])
    photo_records = json.loads(Path(request["photosPath"]).read_text())["photos"]
    photos = {photo["photoId"]: photo for photo in photo_records if photo["kind"] == "accepted" and photo.get("origin", "capture") == "capture"}
    masks = {obj["objectId"]: obj for obj in json.loads(masks_path.read_text())["objects"]}
    objects = request["objects"]
    if len({obj["objectId"] for obj in objects}) != len(objects):
        raise ValueError("Measurement object IDs must be unique")
    result = {"objects": [], "failures": []}
    with np.load(request["scenePath"], allow_pickle=False) as stored:
        scene = {key: stored[key] for key in ("names", "world_points", "masks", "transforms", "image_sizes")}
    for index, obj in enumerate(objects):
        try:
            segmented = masks.get(obj["objectId"])
            if segmented is None:
                raise ValueError("Object has no segmentation masks")
            views = {view["photoId"]: view for view in segmented["views"]}
            selected = []
            for view in obj["views"]:
                photo = photos.get(view["photoId"])
                if photo is None:
                    raise ValueError("Object view does not name an accepted capture photo")
                mask = views.get(view["photoId"])
                if mask is not None:
                    excluded = [other_view for other in masks.values() if other["objectId"] != obj["objectId"] for other_view in other["views"] if other_view["photoId"] == view["photoId"]]
                    points = read_points(scene=scene, view=mask, photo=photo, masks_dir=masks_path.parent, excluded_views=excluded)
                    if not clipped_view(view=view, photo=photo):
                        selected.append((view, points))
            if not any(len(points) >= 30 for _, points in selected):
                raise ValueError("Object masks have fewer than 30 reconstructed points")
            result["objects"].append(measure_views(views=selected, obj=obj, room=request["room"]))
        except (ValueError, OSError) as error:
            result["failures"].append({"objectId": obj["objectId"], "message": str(error)})
        emit({"kind": "progress", "stage": "measuring", "progress": (index + 1) / len(objects), "objectId": obj["objectId"]})
    resolve_floor_support(objects=result["objects"], room=request["room"], floor_covering_ids={obj["objectId"] for obj in objects if is_floor_covering(obj)})
    valid = []
    for obj in result["objects"]:
        try:
            validate_dimensions(obj["sizeM"])
            valid.append(obj)
        except ValueError as error:
            result["failures"].append({"objectId": obj["objectId"], "message": str(error)})
    result["objects"] = valid
    output = Path(request["outputDir"]) / "measurement.json"
    if output.resolve() in {Path(request[key]).resolve() for key in ("scenePath", "masksPath", "photosPath")}:
        raise ValueError("Measurement output must not overwrite its inputs")
    write_json(output, result)
    return result


if __name__ == "__main__":
    run_worker(run)
