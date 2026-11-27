import sys

import numpy as np

from fit_layout import fit_layout

ROOM = (3.0, 5.2, 2.7)
TOLERANCE_M = 0.02


def look_at(*, center, target):
    z = (target - center) / np.linalg.norm(target - center)
    x = np.cross(z, [0, 0, -1.0])
    x /= np.linalg.norm(x)
    pose = np.eye(4)
    pose[:3, :3] = np.stack([x, np.cross(z, x), z], 1)
    pose[:3, 3] = center
    return pose


def render_box(*, pose, height_px=60, width_px=45, focal_px=50):
    ys, xs = np.mgrid[0:height_px, 0:width_px]
    rays = np.stack([(xs - width_px / 2) / focal_px, (ys - height_px / 2) / focal_px, np.ones(xs.shape)], -1) @ pose[:3, :3].T
    origin = pose[:3, 3]
    t = np.full(xs.shape, np.inf)
    for axis, size in enumerate(ROOM):
        for bound in (0.0, size):
            with np.errstate(divide="ignore", invalid="ignore"):
                hit = (bound - origin[axis]) / rays[..., axis]
            t = np.minimum(t, np.where(hit > 0, hit, np.inf))
    return origin + rays * t[..., None]


def main():
    rng = np.random.default_rng(1)
    rotation = np.linalg.qr(rng.normal(size=(3, 3)))[0]
    rotation[:, 0] *= np.sign(np.linalg.det(rotation))
    world = np.eye(4)
    world[:3, :3] = rotation
    poses, points = [], []
    for _ in range(12):
        center = np.array([rng.uniform(0.5, ROOM[0] - 0.5), rng.uniform(0.5, ROOM[1] - 0.5), 1.5])
        target = rng.uniform([0, 0, 0], ROOM)
        pose = look_at(center=center, target=target)
        poses.append(world @ pose)
        points.append((render_box(pose=pose) + rng.normal(0, 0.005, (60, 45, 3))) @ rotation.T)
    n = len(poses)
    layout = fit_layout(
        {
            "world_points": np.array(points),
            "confidence": np.ones((n, 60, 45)),
            "masks": np.ones((n, 60, 45), bool),
            "camera_poses": np.array(poses),
        }
    )
    sides = layout["sides"]
    spans = sorted([sides["x_max"]["pos"] - sides["x_min"]["pos"], sides["y_max"]["pos"] - sides["y_min"]["pos"]])
    errors = [spans[0] - ROOM[0], spans[1] - ROOM[1], layout["height"] - ROOM[2]]
    print(f"fitted {spans[0]:.3f} x {spans[1]:.3f} x {layout['height']:.3f} m; worst error {max(map(abs, errors)) * 1000:.0f} mm")
    return 0 if max(map(abs, errors)) < TOLERANCE_M else 1


if __name__ == "__main__":
    sys.exit(main())
