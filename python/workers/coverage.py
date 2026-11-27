import json
from pathlib import Path

import numpy as np

from protocol import run_worker, write_json


def occupied_cells(*, coordinates, span, cell_size):
    shape = np.maximum(1, np.ceil(np.array(span) / cell_size).astype(int))
    scaled = coordinates / np.array(span) * shape
    indices = np.floor(scaled).astype(int)
    valid = ((indices >= 0) & (indices < shape)).all(axis=1)
    cells = np.unique(indices[valid], axis=0)
    return len(cells) / int(np.prod(shape))


def evaluate(*, room, scene, area_threshold=0.25, min_cameras=2, cell_size=0.15):
    if not 0 <= area_threshold <= 1 or min_cameras < 1 or not np.isfinite(cell_size) or cell_size <= 0:
        raise ValueError("Coverage thresholds must be valid and cell size positive")
    height = room["ceilingHeightM"]
    tolerance = 0.02 * height
    corners = np.array([[w["startM"]["x"], w["startM"]["z"]] for w in room["walls"]])
    points_by_view = [points[mask & np.isfinite(points).all(axis=-1)] for points, mask in zip(scene["world_points"], scene["masks"])]
    surfaces, requests = [], []
    for index, wall in enumerate(room["walls"]):
        start = corners[index]
        edge = corners[(index + 1) % len(corners)] - start
        length = np.linalg.norm(edge)
        direction = edge / length
        normal = np.array([direction[1], -direction[0]])
        coordinates, cameras = [], []
        for name, points in zip(scene["names"], points_by_view):
            delta = points[:, [0, 2]] - start
            along = delta @ direction
            valid = (np.abs(delta @ normal) <= tolerance) & (along >= 0) & (along <= length) & (points[:, 1] >= 0) & (points[:, 1] <= height)
            if valid.sum() >= 3:
                cameras.append(str(name))
            coordinates.append(np.column_stack([along[valid], points[valid, 1]]))
        area = occupied_cells(coordinates=np.concatenate(coordinates) if coordinates else np.empty((0, 2)), span=[length, height], cell_size=cell_size)
        surfaces.append({"surfaceId": wall["id"], "areaShare": area, "cameraCount": len(cameras), "photoIds": cameras})
        if wall["kind"] != "open" and (wall["kind"] == "inferred" or area < area_threshold or len(cameras) < min_cameras):
            midpoint = start + edge / 2
            stand = midpoint + normal * min(1.0, height * 0.4)
            if not inside_polygon(points=stand[None], corners=corners)[0]:
                stand = corners.mean(axis=0)
            facing = midpoint - stand
            facing /= np.linalg.norm(facing)
            requests.append({"surfaceId": wall["id"], "reason": "inferred" if wall["kind"] == "inferred" else "low-coverage", "standAtM": {"x": float(stand[0]), "z": float(stand[1])}, "lookDirection": {"x": float(facing[0]), "z": float(facing[1])}})
    floor_coordinates, floor_cameras = [], []
    for name, points in zip(scene["names"], points_by_view):
        valid = (np.abs(points[:, 1]) <= tolerance) & inside_polygon(points=points[:, [0, 2]], corners=corners)
        if valid.sum() >= 3:
            floor_cameras.append(str(name))
        floor_coordinates.append(points[valid][:, [0, 2]])
    lower, upper = corners.min(axis=0), corners.max(axis=0)
    shape = np.maximum(1, np.ceil((upper - lower) / cell_size).astype(int))
    centers = np.indices(shape).reshape(2, -1).T
    centers = lower + (centers + 0.5) / shape * (upper - lower)
    floor_cells = inside_polygon(points=centers, corners=corners).sum()
    coordinates = np.concatenate(floor_coordinates) if floor_coordinates else np.empty((0, 2))
    share = occupied_cells(coordinates=coordinates - lower, span=upper - lower, cell_size=cell_size)
    floor_share = min(1.0, share * int(np.prod(shape)) / max(1, int(floor_cells)))
    surfaces.append({"surfaceId": "floor", "areaShare": floor_share, "cameraCount": len(floor_cameras), "photoIds": floor_cameras})
    if floor_share < area_threshold or len(floor_cameras) < min_cameras:
        center = corners.mean(axis=0)
        requests.append({"surfaceId": "floor", "reason": "low-coverage", "standAtM": {"x": float(center[0]), "z": float(center[1])}, "lookDirection": {"x": 0, "y": -1, "z": 0}})
    return {"surfaces": surfaces, "captureRequests": requests}


def inside_polygon(*, points, corners):
    inside = np.ones(len(points), dtype=bool)
    for index, start in enumerate(corners):
        edge = corners[(index + 1) % len(corners)] - start
        delta = points - start
        inside &= edge[0] * delta[:, 1] - edge[1] * delta[:, 0] <= 1e-6
    return inside


def run(request):
    recon_dir = Path(request["reconDir"])
    room = json.loads((recon_dir / "room.json").read_text())
    with np.load(recon_dir / room["scenePath"], allow_pickle=False) as stored:
        scene = {key: stored[key] for key in ("world_points", "masks", "names")}
    result = evaluate(room=room, scene=scene, area_threshold=request.get("areaThreshold", 0.25), min_cameras=request.get("minCameras", 2), cell_size=request.get("cellSizeM", 0.15))
    write_json(recon_dir / "coverage.json", result)
    return result


if __name__ == "__main__":
    run_worker(run)
