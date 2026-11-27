import uuid

import numpy as np

from fit_layout import collect_points
from wall_line import wall_line
from match_wall_ids import match_wall_ids


def build_room(*, scene, layout, factor, previous=None, previous_cameras=None):
    points, normals = collect_points(scene)
    basis = np.array([layout["ax"], layout["up"], -np.array(layout["ay"])])
    projected = points @ basis.T
    sides = layout["sides"]
    center = np.array([
        (sides["x_min"]["pos"] + sides["x_max"]["pos"]) / 2,
        layout["floor_h"],
        -(sides["y_min"]["pos"] + sides["y_max"]["pos"]) / 2,
    ])
    height = layout["height"]
    vertical = (np.abs(normals @ basis[1]) < 0.25) & (projected[:, 1] > center[1] + 0.05 * height) & (projected[:, 1] < center[1] + 0.95 * height)
    floor_points = projected[vertical][:, [0, 2]]
    wall_heights = projected[vertical, 1]
    floor_normals = (normals[vertical] @ basis.T)[:, [0, 2]]
    definitions = [
        ("x_min", np.array([1.0, 0]), sides["x_min"]["pos"]),
        ("y_min", np.array([0.0, 1]), -sides["y_min"]["pos"]),
        ("x_max", np.array([1.0, 0]), sides["x_max"]["pos"]),
        ("y_max", np.array([0.0, 1]), -sides["y_max"]["pos"]),
    ]
    rng = np.random.default_rng(0)
    observations = np.concatenate([scene["world_points"][scene["masks"]], scene["camera_poses"][:, :3, 3]]) @ basis.T
    bounds = np.array([observations[:, [0, 2]].min(axis=0), observations[:, [0, 2]].max(axis=0)])
    lines = [wall_line(points=floor_points, normal=n, offset=d, height=height, rng=rng, surface_normals=floor_normals) if sides[key]["plane"] else (n, d) for key, n, d in definitions]
    rejected = set()
    for index, (normal, offset) in enumerate(lines):
        tangent = np.array([-normal[1], normal[0]])
        facing = np.abs(floor_normals @ normal) >= np.abs(floor_normals @ tangent)
        count = np.count_nonzero(facing & (np.abs(floor_points @ normal - offset) < 0.02 * height))
        if count < 30:
            _, normal, _ = definitions[index]
            axis = int(np.argmax(normal))
            bound = 0 if index in (0, 3) else 1
            lines[index] = (normal, bounds[bound, axis])
            rejected.add(index)
    for _ in range(5):
        corners = []
        invalid = set()
        for index, (normal, offset) in enumerate(lines):
            other_normal, other_offset = lines[index - 1]
            matrix = np.array([normal, other_normal])
            if abs(np.linalg.det(matrix)) < 0.1:
                invalid.update([index, (index - 1) % 4])
                corners.append([np.nan, np.nan])
                continue
            corner = np.linalg.solve(matrix, np.array([offset, other_offset]))
            if not np.isfinite(corner).all() or np.any(corner < bounds[0] - 0.12 * height) or np.any(corner > bounds[1] + 0.12 * height):
                invalid.update([index, (index - 1) % 4])
            corners.append(corner)
        corners = np.array(corners)
        edges = np.roll(corners, -1, axis=0) - corners
        turns = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
        if not invalid and np.all(turns < 0):
            break
        if not invalid:
            invalid = set(range(4))
        for index in invalid:
            _, normal, _ = definitions[index]
            axis = int(np.argmax(normal))
            bound = 0 if index in (0, 3) else 1
            lines[index] = (normal, bounds[bound, axis])
        rejected.update(invalid)
    aligned_cameras = align_scene(scene={"camera_poses": scene["camera_poses"], "world_points": np.empty((0, 3))}, basis=basis, center=center, factor=factor)["camera_poses"]
    old_ids = match_wall_ids(corners=(corners - center[[0, 2]]) * factor, names=scene["names"], poses=aligned_cameras, previous=previous, previous_cameras=previous_cameras)
    walls, confidence = [], []
    for index, (key, _, _) in enumerate(definitions):
        start, edge = corners[index], edges[index]
        length = np.linalg.norm(edge)
        normal, offset = lines[index]
        along = (floor_points - start) @ (edge / length)
        distance = np.abs(floor_points @ normal - offset)
        tangent = np.array([-normal[1], normal[0]])
        facing = np.abs(floor_normals @ normal) >= np.abs(floor_normals @ tangent)
        inliers = facing & (distance < 0.02 * height) & (along >= 0) & (along <= length)
        bins = max(5, int(np.ceil(length / (0.1 * height))))
        bin_indices = np.minimum(bins - 1, (along[inliers] / length * bins).astype(int))
        heights = wall_heights[inliers]
        supported = []
        for bin_index in range(bins):
            bin_heights = heights[bin_indices == bin_index]
            supported.append(len(bin_heights) >= 3 and np.percentile(bin_heights, 95) - np.percentile(bin_heights, 5) >= 0.35 * height)
        extent = float(np.mean(supported))
        plane_found = bool(index not in rejected and sides[key]["plane"] and inliers.sum() >= 30)
        count = int(inliers.sum()) if plane_found else 0
        residual = float(np.sqrt(np.mean(distance[inliers] ** 2))) if count else 0.02 * height
        wall_id = old_ids.get(index, str(uuid.uuid4()))
        position = (start - center[[0, 2]]) * factor
        walls.append({"id": wall_id, "startM": {"x": float(position[0]), "z": float(position[1])}, "kind": "solid" if count and extent >= 0.75 else "inferred"})
        confidence.append({"wallId": wall_id, "side": key, "planeFound": plane_found, "inlierCount": count, "residualM": residual * factor, "lengthCoverage": extent, "value": float(count / (count + 200) * np.exp(-residual / (0.02 * height)) * extent)})
    return {"walls": walls, "ceilingHeightM": height * factor, "confidence": confidence, "ceilingPlaneFound": layout["ceiling_plane"]}, basis, center


def align_scene(*, scene, basis, center, factor):
    poses = scene["camera_poses"].copy()
    poses[:, :3, :3] = basis @ poses[:, :3, :3]
    poses[:, :3, 3] = (poses[:, :3, 3] @ basis.T - center) * factor
    return {**scene, "world_points": ((scene["world_points"] @ basis.T - center) * factor).astype(np.float32), "camera_poses": poses}
