"""Coordinates are Blender's: +Z up, -Y front. `faces` holds triangles as vertex indices."""

import numpy as np

AXES = ("x", "y", "z")
SIDES = (("z", -1), ("y", 1), ("y", -1), ("x", 1), ("x", -1))
BAND_SHARE = 0.1
GRID_CELLS = 48
MIN_SLAB_SHARE = 0.25
MIN_COMPONENT_SHARE = 0.05
MIN_SUPPORT_SHARE = 0.5
MIN_FLOOR_SHARE = 2.0
NEAR_SHARE = 0.1


def weld(vertices):
    """Return one id per vertex, equal for vertices at the same position."""
    extent = float(np.ptp(vertices, axis=0).max()) or 1.0
    keys = np.round(vertices / (extent * 1e-5)).astype(np.int64)
    _, ids = np.unique(keys, axis=0, return_inverse=True)
    return ids.reshape(-1)


def label_components(*, faces, ids):
    corners = ids[faces]
    labels = np.arange(ids.max() + 1)
    while True:
        lowest = labels[corners].min(axis=1)
        updated = labels.copy()
        for column in range(3):
            np.minimum.at(updated, corners[:, column], lowest)
        updated = updated[updated]
        if np.array_equal(updated, labels):
            return labels[corners[:, 0]]
        labels = updated


def face_areas(*, vertices, faces):
    corners = vertices[faces]
    return np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) / 2


def proportion_error(*, size, expected):
    size = np.maximum(np.asarray(size, dtype=float), 1e-9)
    expected = np.asarray(expected, dtype=float)
    return float(np.abs(np.log((size / size.max()) / (expected / expected.max()))).sum())


def bounds_size(*, vertices, faces, keep):
    used = vertices[faces[keep]].reshape(-1, 3)
    return np.ptp(used, axis=0) if len(used) else np.zeros(3)


def find_slab(*, vertices, faces, labels, keep, axis, direction):
    used = vertices[faces[keep]].reshape(-1, 3)
    low, high = used.min(axis=0), used.max(axis=0)
    extent = high - low
    index = AXES.index(axis)
    if extent[index] <= 0:
        return np.zeros(len(faces), dtype=bool)
    edge = low[index] if direction < 0 else high[index]
    depth = np.abs(vertices[:, index] - edge)
    in_band = keep & (depth[faces].max(axis=1) <= BAND_SHARE * extent[index])
    body = keep & ~in_band
    if not body.any():
        return np.zeros(len(faces), dtype=bool)
    body_points = vertices[np.unique(faces[body])]
    separate = ~np.isin(labels, np.unique(labels[body]))
    others = [other for other in range(3) if other != index]
    if not stands_without_slab(vertices=body_points, index=index, direction=direction, extent=extent):
        body_span = np.ptp(body_points[:, others], axis=0)
        wide = [
            label
            for label in np.unique(labels[in_band & separate])
            if (np.ptp(vertices[np.unique(faces[in_band & (labels == label)])][:, others], axis=0) >= MIN_FLOOR_SHARE * body_span).all()
        ]
        return in_band & np.isin(labels, wide)
    cell = np.maximum(extent[others], 1e-9) / GRID_CELLS

    def cells(points):
        return np.clip(((points[:, others] - low[others]) / cell).astype(int), 0, GRID_CELLS - 1)

    occupied = np.zeros((GRID_CELLS, GRID_CELLS), dtype=bool)
    body_cells = cells(body_points)
    occupied[body_cells[:, 0], body_cells[:, 1]] = True
    grown = occupied.copy()
    grown[1:, :] |= occupied[:-1, :]
    grown[:-1, :] |= occupied[1:, :]
    grown[:, 1:] |= occupied[:, :-1]
    grown[:, :-1] |= occupied[:, 1:]
    vertex_cells = cells(vertices)
    outside = (~grown[vertex_cells[:, 0], vertex_cells[:, 1]])[faces].any(axis=1)
    return in_band & (outside | separate)


def stands_without_slab(*, vertices, index, direction, extent):
    """Return `true` if the part of `vertices` nearest the side spans at least `MIN_SUPPORT_SHARE` of their extent on both other axes; `false` when it is narrower, like a lamp stem above its base."""
    level = vertices[:, index] * direction
    nearest = vertices[level >= level.max() - BAND_SHARE * extent[index]]
    others = [other for other in range(3) if other != index]
    span = np.ptp(nearest[:, others], axis=0)
    full = np.maximum(np.ptp(vertices[:, others], axis=0), 1e-9)
    return bool((span >= MIN_SUPPORT_SHARE * full).all())


def drop_scraps(*, vertices, faces, areas, ids, keep):
    """Return `keep` without the small pieces whose centre lies outside the largest piece's bounds grown by `NEAR_SHARE` of its largest side, or that lie in the bottom `BAND_SHARE` of the height outside the largest piece's footprint."""
    indices = np.flatnonzero(keep)
    labels = label_components(faces=faces[indices], ids=ids)
    totals = np.bincount(labels, weights=areas[indices])
    largest = vertices[faces[indices[labels == totals.argmax()]]].reshape(-1, 3)
    low, high = largest.min(axis=0), largest.max(axis=0)
    margin = NEAR_SHARE * float((high - low).max())
    counts = np.maximum(np.bincount(labels, minlength=len(totals)), 1)
    face_centres = vertices[faces[indices]].mean(axis=1)
    centres = np.stack([np.bincount(labels, weights=face_centres[:, axis], minlength=len(totals)) / counts for axis in range(3)], axis=1)
    is_near = ((centres >= low - margin) & (centres <= high + margin)).all(axis=1)
    tops = np.full(len(totals), -np.inf)
    np.maximum.at(tops, labels, vertices[faces[indices]][:, :, 2].max(axis=1))
    used = vertices[faces[indices]].reshape(-1, 3)
    floor_top = used[:, 2].min() + BAND_SHARE * float(np.ptp(used[:, 2]))
    is_on_floor = (tops <= floor_top) & ~in_footprint(points=centres, footprint=largest)
    is_large = totals >= MIN_COMPONENT_SHARE * totals.max()
    result = np.zeros(len(faces), dtype=bool)
    result[indices[(is_large | (is_near & ~is_on_floor))[labels]]] = True
    return result


def in_footprint(*, points, footprint):
    """Return `true` for each of `points` whose x and y fall in a cell occupied by `footprint` seen from above, grown by one cell."""
    low, high = footprint[:, :2].min(axis=0), footprint[:, :2].max(axis=0)
    cell = np.maximum(high - low, 1e-9) / GRID_CELLS
    occupied = np.zeros((GRID_CELLS + 2, GRID_CELLS + 2), dtype=bool)
    footprint_cells = np.clip(((footprint[:, :2] - low) / cell).astype(int), 0, GRID_CELLS - 1) + 1
    occupied[footprint_cells[:, 0], footprint_cells[:, 1]] = True
    grown = occupied.copy()
    grown[1:, :] |= occupied[:-1, :]
    grown[:-1, :] |= occupied[1:, :]
    grown[:, 1:] |= occupied[:, :-1]
    grown[:, :-1] |= occupied[:, 1:]
    point_cells = np.floor((points[:, :2] - low) / cell).astype(int) + 1
    inside = ((point_cells >= 0) & (point_cells < GRID_CELLS + 2)).all(axis=1)
    point_cells = np.clip(point_cells, 0, GRID_CELLS + 1)
    return inside & grown[point_cells[:, 0], point_cells[:, 1]]


def clean_mesh(*, vertices, faces, expected, is_floor_covering):
    """Return a mask of the `faces` to keep after removing side slabs, only when that brings the bounds closer to the proportions of `expected` (width, depth, height), and loose pieces, only when that leaves them no further away."""
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces, dtype=np.int64)
    areas = face_areas(vertices=vertices, faces=faces)
    ids = weld(vertices)
    labels = label_components(faces=faces, ids=ids)
    keep = np.ones(len(faces), dtype=bool)
    removed_sides = []
    if not is_floor_covering:
        for axis, direction in SIDES:
            slab = find_slab(vertices=vertices, faces=faces, labels=labels, keep=keep, axis=axis, direction=direction)
            if areas[slab].sum() < MIN_SLAB_SHARE * areas[keep].sum():
                continue
            candidate = drop_scraps(vertices=vertices, faces=faces, areas=areas, ids=ids, keep=keep & ~slab)
            before = proportion_error(size=bounds_size(vertices=vertices, faces=faces, keep=keep), expected=expected)
            after = proportion_error(size=bounds_size(vertices=vertices, faces=faces, keep=candidate), expected=expected)
            if after < before:
                keep = candidate
                removed_sides.append(f"{'+' if direction > 0 else '-'}{axis}")
    without_scraps = drop_scraps(vertices=vertices, faces=faces, areas=areas, ids=ids, keep=keep)
    if proportion_error(size=bounds_size(vertices=vertices, faces=faces, keep=without_scraps), expected=expected) <= proportion_error(
        size=bounds_size(vertices=vertices, faces=faces, keep=keep), expected=expected
    ) + 1e-6:
        keep = without_scraps
    return keep, {
        "removedSides": removed_sides,
        "removedFaceShare": float(1 - keep.mean()),
        "removedAreaShare": float(areas[~keep].sum() / max(areas.sum(), 1e-12)),
    }
