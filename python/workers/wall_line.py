import numpy as np


def wall_line(*, points, normal, offset, height, rng, surface_normals=None):
    if surface_normals is not None:
        tangent = np.array([-normal[1], normal[0]])
        points = points[np.abs(surface_normals @ normal) >= np.abs(surface_normals @ tangent)]
    band = points[np.abs(points @ normal - offset) < 0.12 * height]
    if len(band) < 30:
        return normal, offset
    sample = band[rng.choice(len(band), min(5000, len(band)), replace=False)]
    best_normal, best_offset = normal, offset
    best_count = np.count_nonzero(np.abs(sample @ normal - offset) < 0.015 * height)
    for _ in range(80):
        a, b = sample[rng.integers(len(sample), size=2)]
        tangent = b - a
        length = np.linalg.norm(tangent)
        if length < 0.1 * height:
            continue
        candidate = np.array([-tangent[1], tangent[0]]) / length
        if abs(candidate @ normal) <= np.sqrt(0.5):
            continue
        candidate_offset = a @ candidate
        count = np.count_nonzero(np.abs(sample @ candidate - candidate_offset) < 0.015 * height)
        if count > best_count:
            best_normal, best_offset, best_count = candidate, candidate_offset, count
    selected = points[np.abs(points @ best_normal - best_offset) < 0.02 * height]
    if len(selected) < 30:
        return normal, offset
    center = selected.mean(axis=0)
    centered = selected - center
    candidate = np.linalg.eigh(centered.T @ centered)[1][:, 0]
    if candidate @ normal < 0:
        candidate = -candidate
    fitted_offset = float(center @ candidate)
    consistent = (np.abs(points @ candidate - fitted_offset) < 0.02 * height) | (np.abs(points @ normal - offset) < 0.02 * height)
    selected = points[consistent]
    square_offset = float(np.mean(selected @ normal))
    free_error = np.sqrt(np.mean((selected @ candidate - fitted_offset) ** 2))
    square_error = np.sqrt(np.mean((selected @ normal - square_offset) ** 2))
    angle = np.degrees(np.arccos(np.clip(candidate @ normal, -1, 1)))
    if 3 < angle < 45 and free_error < square_error * 0.6:
        return candidate, fitted_offset
    square_inliers = points[np.abs(points @ normal - offset) < 0.02 * height]
    return normal, float(np.mean(square_inliers @ normal)) if len(square_inliers) >= 30 else offset
