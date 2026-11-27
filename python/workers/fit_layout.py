import numpy as np


RNG_SEED = 0
PIXEL_STEP = 2
MIN_CONF_PERCENTILE = 30
HORIZONTAL_DOT = 0.9
VERTICAL_DOT = 0.25
CEILING_MIN_SHARE = 0.01
WALL_MIN_SHARE = 0.02
WALL_MIN_EXTENT = 0.35


def grid_normals(points):
    du = np.zeros_like(points)
    dv = np.zeros_like(points)
    du[:, 1:-1] = points[:, 2:] - points[:, :-2]
    dv[1:-1, :] = points[2:, :] - points[:-2, :]
    normals = np.cross(du, dv)
    length = np.linalg.norm(normals, axis=-1, keepdims=True)
    return np.where(length > 0, normals / np.maximum(length, 1e-12), 0)


def collect_points(scene):
    """Return confident points and their normals, sampled every `PIXEL_STEP` pixels."""
    pts, nrm = [], []
    for points, conf, mask in zip(scene["world_points"], scene["confidence"], scene["masks"]):
        keep = mask & (conf >= np.percentile(conf[mask], MIN_CONF_PERCENTILE)) if mask.any() else mask
        points = points[::PIXEL_STEP, ::PIXEL_STEP]
        normals = grid_normals(points)
        keep = keep[::PIXEL_STEP, ::PIXEL_STEP] & (np.linalg.norm(normals, axis=-1) > 0)
        pts.append(points[keep])
        nrm.append(normals[keep])
    return np.concatenate(pts), np.concatenate(nrm)


def up_from_cameras(poses):
    rights = poses[:, :3, 0]
    up = np.linalg.svd(rights)[2][-1]
    camera_up = -poses[:, :3, 1]
    return up if (camera_up @ up).mean() > 0 else -up


def fit_plane(points, *, rng, iters=500, tol):
    best = (None, None, np.zeros(len(points), bool))
    for _ in range(iters):
        a, b, c = points[rng.integers(len(points), size=3)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-12:
            continue
        n /= np.linalg.norm(n)
        inliers = np.abs(points @ n - a @ n) < tol
        if inliers.sum() > best[2].sum():
            best = (n, a @ n, inliers)
    inl = points[best[2]]
    centroid = inl.mean(0)
    centered = inl - centroid
    n = np.linalg.eigh(centered.T @ centered)[1][:, 0]
    return n, centroid @ n, best[2]


def histogram_peaks(values, *, bin_size, min_count):
    if len(values) == 0:
        return []
    edges = np.arange(values.min() - bin_size, values.max() + 2 * bin_size, bin_size)
    counts, edges = np.histogram(values, edges)
    smooth = np.convolve(counts, [1, 2, 1], mode="same") / 4
    peaks = []
    for i in range(1, len(smooth) - 1):
        if smooth[i] >= smooth[i - 1] and smooth[i] > smooth[i + 1] and counts[i - 1 : i + 2].sum() >= min_count:
            window = (values >= edges[i - 1]) & (values < edges[i + 2])
            peaks.append((float(np.median(values[window])), int(window.sum())))
    return peaks


def fit_layout(scene):
    rng = np.random.default_rng(RNG_SEED)
    pts, nrm = collect_points(scene)
    poses = scene["camera_poses"]
    cams = poses[:, :3, 3]
    if len(pts) < 100 or len(poses) < 2:
        raise ValueError("Layout needs at least two cameras and 100 surface points")

    up = up_from_cameras(poses)
    h = pts @ up
    unit = float(np.percentile(h, 99) - np.percentile(h, 1))
    cam_h = float(np.median(cams @ up))

    horizontal = np.abs(nrm @ up) > HORIZONTAL_DOT
    below = horizontal & (h < cam_h)
    floor_peaks = histogram_peaks(h[below], bin_size=0.01 * unit, min_count=1)
    if not floor_peaks or unit <= 0:
        raise ValueError("No floor plane found")
    floor_h = max(floor_peaks, key=lambda p: p[1])[0]
    near_floor = below & (np.abs(h - floor_h) < 0.03 * unit)
    floor_n, _, _ = fit_plane(pts[near_floor], rng=rng, tol=0.01 * unit)
    up = floor_n if floor_n @ up > 0 else -floor_n
    h = pts @ up
    cam_h = float(np.median(cams @ up))
    floor_h = float(np.median(h[near_floor]))

    horizontal = np.abs(nrm @ up) > HORIZONTAL_DOT
    above = horizontal & (h > cam_h)
    ceiling_peaks = histogram_peaks(h[above], bin_size=0.01 * unit, min_count=int(CEILING_MIN_SHARE * horizontal.sum()))
    ceiling_plane = bool(ceiling_peaks)
    ceiling_h = max(ceiling_peaks, key=lambda p: p[1])[0] if ceiling_plane else float(np.percentile(h, 99.5))
    height = ceiling_h - floor_h
    if height <= 0:
        raise ValueError("Ceiling must be above the floor")

    e1 = np.cross(up, [0, 0, 1.0] if abs(up[2]) < 0.9 else [1.0, 0, 0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    vertical = (np.abs(nrm @ up) < VERTICAL_DOT) & (h > floor_h + 0.05 * height) & (h < ceiling_h - 0.05 * height)
    n2 = np.stack([nrm[vertical] @ e1, nrm[vertical] @ e2], 1)
    angles = np.mod(np.arctan2(n2[:, 1], n2[:, 0]), np.pi / 2)
    hist, edges = np.histogram(angles, bins=90, range=(0, np.pi / 2))
    theta = edges[np.argmax(np.convolve(np.r_[hist[-2:], hist, hist[:2]], np.ones(5), "valid"))] + edges[1] / 2
    ax = np.cos(theta) * e1 + np.sin(theta) * e2
    ay = np.cross(up, ax)

    wall_pts = pts[vertical]
    wall_nrm = nrm[vertical]
    wall_h = h[vertical]
    if len(wall_pts) < 30:
        raise ValueError("Not enough vertical surface points to fit walls")
    observations = np.concatenate([scene["world_points"][scene["masks"]], cams])
    cam_center = np.median(cams, 0)
    sides = {}
    for axis_name, axis in (("x", ax), ("y", ay)):
        along = wall_pts @ axis
        other_axis = ay if axis_name == "x" else ax
        facing = np.abs(wall_nrm @ axis) >= np.abs(wall_nrm @ other_axis)
        peaks = histogram_peaks(along[facing], bin_size=0.01 * height, min_count=int(WALL_MIN_SHARE * facing.sum()))
        center = cam_center @ axis
        for sign, side in ((-1, "min"), (1, "max")):
            candidates = []
            for pos, count in peaks:
                if (pos - center) * sign <= 0:
                    continue
                inl = facing & (np.abs(along - pos) < 0.02 * height)
                extent = (np.percentile(wall_h[inl], 95) - np.percentile(wall_h[inl], 5)) / height
                if extent >= WALL_MIN_EXTENT:
                    candidates.append({"pos": pos, "count": count, "extent": float(extent)})
            best = max(candidates, key=lambda c: c["count"] * c["extent"], default=None)
            outer = [c for c in candidates if best and (c["pos"] - best["pos"]) * sign > 0.05 * height]
            if best is None:
                support = observations @ axis
                fallback = support.max() if sign > 0 else support.min()
                best = {"pos": float(fallback), "count": 0, "extent": 0.0}
            sides[f"{axis_name}_{side}"] = {**best, "plane": best["count"] > 0, "outer_planes": outer, "axis": axis_name}
    return {
        "up": up.tolist(),
        "ax": ax.tolist(),
        "ay": ay.tolist(),
        "floor_h": floor_h,
        "ceiling_h": ceiling_h,
        "ceiling_plane": ceiling_plane,
        "height": height,
        "sides": sides,
        "points_used": int(len(pts)),
    }
