import numpy as np


def match_wall_ids(*, corners, names, poses, previous, previous_cameras):
    if not previous or not previous_cameras:
        return {}
    old_poses = {camera["photoId"]: np.array(camera["cameraToWorld"]) for camera in previous_cameras}
    shared = [(pose, old_poses[str(name)]) for name, pose in zip(names, poses) if str(name) in old_poses]
    if len(shared) < 2:
        return {}
    current, old = np.array([pair[0] for pair in shared]), np.array([pair[1] for pair in shared])
    rotations = old[:, :3, :3] @ current[:, :3, :3].transpose(0, 2, 1)
    u, _, vt = np.linalg.svd(rotations.mean(axis=0))
    rotation = u @ np.diag([1, 1, np.linalg.det(u @ vt)]) @ vt
    source = current[:, :3, 3] @ rotation.T
    target = old[:, :3, 3]
    source_center, target_center = source.mean(axis=0), target.mean(axis=0)
    denominator = np.sum((source - source_center) ** 2)
    if denominator < 1e-8:
        return {}
    scale = np.sum((source - source_center) * (target - target_center)) / denominator
    residual = np.linalg.norm((source - source_center) * scale - (target - target_center), axis=1)
    tolerance = 0.15 * previous["ceilingHeightM"]
    if scale <= 0 or np.max(residual) > tolerance / 3:
        return {}
    points = np.column_stack([corners[:, 0], np.zeros(len(corners)), corners[:, 1]])
    registered = ((points @ rotation.T - source_center) * scale + target_center)[:, [0, 2]]
    old_corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in previous["walls"]])
    old_edges = np.roll(old_corners, -1, axis=0) - old_corners
    old_normals = np.column_stack([-old_edges[:, 1], old_edges[:, 0]]) / np.linalg.norm(old_edges, axis=1, keepdims=True)
    edges = np.roll(registered, -1, axis=0) - registered
    normals = np.column_stack([-edges[:, 1], edges[:, 0]]) / np.linalg.norm(edges, axis=1, keepdims=True)
    costs = np.full((len(corners), len(old_corners)), np.inf)
    for index, start in enumerate(registered):
        distances = np.maximum(np.abs(np.sum((start - old_corners) * old_normals, axis=1)), np.abs(np.sum((registered[(index + 1) % len(corners)] - old_corners) * old_normals, axis=1)))
        matches = (old_normals @ normals[index] > np.cos(np.radians(15))) & (distances < tolerance)
        costs[index, matches] = distances[matches]
    result = {}
    for index in range(len(corners)):
        match = int(np.argmin(costs[index]))
        if np.isfinite(costs[index, match]) and np.argmin(costs[:, match]) == index:
            result[index] = previous["walls"][match]["id"]
    return result
