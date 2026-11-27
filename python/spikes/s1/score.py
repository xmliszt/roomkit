"""S1 gate: score every saved model run against the reference room and print the table.

Reads `~/.cache/interior-planner-spikes/s1/runs/<model>/<run>/{scene.npz,measure.json}`; never runs a model.
Writes `layout.json`, `score.json` and `topdown.png` next to each scene.
Exit 0 when every run scored; 1 when there are no runs or a run's files are missing or unreadable.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from fit_layout import fit_layout, load_scene
from paths import OUT_DIR

PASS_TIME_S = 600
PASS_PEAK_GB = 24
PASS_ERR = 0.10
WINDOW_PX = 2
REGISTER_MARGIN = 0.15
REGISTER_FOCAL_TOL = 0.25
REGISTER_INSIDE_SHARE = 0.5
PICKS = json.loads((Path(__file__).parent / "picks.json").read_text())
REF = PICKS["roomM"]
PHOTOS = {p["name"]: p for p in json.loads((OUT_DIR / "photos.json").read_text())}


def point_at(scene, *, photo, at):
    """Return the median 3D point of the masked pixels in a small window around normalized JPEG coords `at`, or None if `photo` is not in the run, `at` falls outside the grid, or no pixel there is masked."""
    names = list(scene["names"])
    if photo not in names:
        return None
    i = names.index(photo)
    scale, left, top = scene["transforms"][i]
    meta = PHOTOS[photo]
    x = int(round(at[0] * meta["width"] * scale - left))
    y = int(round(at[1] * meta["height"] * scale - top))
    grid = scene["world_points"][i]
    h, w = grid.shape[:2]
    if not (WINDOW_PX <= x < w - WINDOW_PX and WINDOW_PX <= y < h - WINDOW_PX):
        return None
    window = grid[y - WINDOW_PX : y + WINDOW_PX + 1, x - WINDOW_PX : x + WINDOW_PX + 1].reshape(-1, 3)
    valid = scene["masks"][i][y - WINDOW_PX : y + WINDOW_PX + 1, x - WINDOW_PX : x + WINDOW_PX + 1].reshape(-1)
    if not valid.any():
        return None
    return np.median(window[valid], 0)


def furniture_lengths(scene):
    lengths = {}
    for name, piece in PICKS["furniture"].items():
        for cand in piece["candidates"]:
            a = point_at(scene, photo=cand["photo"], at=cand["a"])
            b = point_at(scene, photo=cand["photo"], at=cand["b"])
            if a is not None and b is not None:
                lengths[name] = float(np.linalg.norm(a - b))
                break
    return lengths


def name_walls(scene, layout):
    """Return {window, end, left, right} -> side key, using the wall anchors in `picks.json`."""
    sides = layout["sides"]
    axes = {"x": np.array(layout["ax"]), "y": np.array(layout["ay"])}

    def nearest_side(anchors):
        best = None
        for anchor in anchors:
            p = point_at(scene, photo=anchor["photo"], at=anchor["at"])
            if p is None:
                continue
            for key, side in sides.items():
                d = abs(p @ axes[side["axis"]] - side["pos"])
                if best is None or d < best[0]:
                    best = (d, key)
        return best[1] if best else None

    def opposite(key):
        axis, side = key.split("_")
        return f"{axis}_{'max' if side == 'min' else 'min'}"

    left = nearest_side(PICKS["walls"]["left"])
    right = nearest_side(PICKS["walls"]["right"])
    side_axis = (left or right or "x_min")[0]
    window = nearest_side(PICKS["walls"]["window"]) or f"{'y' if side_axis == 'x' else 'x'}_max"
    end = opposite(window)
    cross = "x" if window.startswith("y") else "y"
    if left is None or not left.startswith(cross):
        left = opposite(right) if right and right.startswith(cross) else f"{cross}_min"
    if right is None or not right.startswith(cross) or right == left:
        right = opposite(left)
    return {"window": window, "end": end, "left": left, "right": right}


def registered(scene, layout):
    """Return the names of views whose camera sits inside the fitted room, whose focal matches EXIF, and whose points mostly fall inside the room."""
    sides = layout["sides"]
    axes = {"x": np.array(layout["ax"]), "y": np.array(layout["ay"])}
    up = np.array(layout["up"])
    margin = REGISTER_MARGIN * layout["height"]
    bounds = {}
    for axis in ("x", "y"):
        lo, hi = sorted([sides[f"{axis}_min"]["pos"], sides[f"{axis}_max"]["pos"]])
        bounds[axis] = (lo - margin, hi + margin)

    def inside(p):
        h = p @ up
        ok = (h > layout["floor_h"] - margin) & (h < layout["ceiling_h"] + margin)
        for axis, (lo, hi) in bounds.items():
            c = p @ axes[axis]
            ok &= (c > lo) & (c < hi)
        return ok

    names = []
    for i, name in enumerate(scene["names"]):
        cam = scene["camera_poses"][i][:3, 3]
        focal_jpeg = scene["intrinsics"][i][0, 0] / scene["transforms"][i][0]
        focal_ok = abs(focal_jpeg / PHOTOS[name]["focal_px"] - 1) < REGISTER_FOCAL_TOL
        pts = scene["world_points"][i][scene["masks"][i]]
        share = inside(pts[::7]).mean() if len(pts) else 0
        if inside(cam[None])[0] and focal_ok and share >= REGISTER_INSIDE_SHARE:
            names.append(str(name))
    return names


def plot_topdown(*, scene, layout, walls, path, title):
    up = np.array(layout["up"])
    ax, ay = np.array(layout["ax"]), np.array(layout["ay"])
    pts = scene["world_points"][scene["masks"]][::40]
    h = pts @ up
    band = (h > layout["floor_h"] + 0.3 * layout["height"]) & (h < layout["ceiling_h"] - 0.1 * layout["height"])
    fig, axes = plt.subplots(figsize=(7, 7))
    axes.scatter(pts[band] @ ax, pts[band] @ ay, s=0.2, c="0.5", alpha=0.4)
    s = layout["sides"]
    xs = [s["x_min"]["pos"], s["x_max"]["pos"]]
    ys = [s["y_min"]["pos"], s["y_max"]["pos"]]
    axes.plot([xs[0], xs[1], xs[1], xs[0], xs[0]], [ys[0], ys[0], ys[1], ys[1], ys[0]], "r-", lw=1.5)
    for label, key in walls.items():
        side = s[key]
        x = side["pos"] if side["axis"] == "x" else np.mean(xs)
        y = side["pos"] if side["axis"] == "y" else np.mean(ys)
        axes.text(x, y, f"{label}{'' if side['plane'] else ' (no plane)'}", color="red", ha="center")
    for i, name in enumerate(scene["names"]):
        pose = scene["camera_poses"][i]
        c, d = pose[:3, 3], pose[:3, 2]
        axes.arrow(c @ ax, c @ ay, 0.3 * (d @ ax), 0.3 * (d @ ay), head_width=0.05, color="tab:blue")
        axes.text(c @ ax, c @ ay, str(name)[-4:], fontsize=6)
    axes.set_aspect("equal")
    axes.set_title(title)
    fig.savefig(path, dpi=130)
    plt.close(fig)


def score_run(run_dir):
    scene = load_scene(run_dir)
    measure = json.loads((run_dir / "measure.json").read_text())
    run_info = json.loads((run_dir / "run.json").read_text())
    layout = fit_layout(scene)
    (run_dir / "layout.json").write_text(json.dumps(layout, indent=2))
    walls = name_walls(scene, layout)
    sides = layout["sides"]
    metric = {
        "width": abs(sides[walls["left"]]["pos"] - sides[walls["right"]]["pos"]),
        "length": abs(sides[walls["window"]]["pos"] - sides[walls["end"]]["pos"]),
        "ceiling": layout["height"],
    }
    lengths = furniture_lengths(scene)
    scaled = {}
    for piece, d in lengths.items():
        k = PICKS["furniture"][piece]["length_m"] / d
        scaled[piece] = {
            "k": k,
            "room": {key: v * k for key, v in metric.items()},
            "furniture_err": {
                other: lengths[other] * k / PICKS["furniture"][other]["length_m"] - 1 for other in lengths if other != piece
            },
        }
    reg = registered(scene, layout)
    open_side = sides[walls["left"]]["outer_planes"]
    result = {
        "model": run_dir.parent.name,
        "run": run_dir.name,
        "views": len(scene["names"]),
        "registered": len(reg),
        "registered_names": reg,
        "metric": metric,
        "furniture_m": lengths,
        "scaled": scaled,
        "walls": {label: {"side": key, "plane": sides[key]["plane"]} for label, key in walls.items()},
        "open_side_planes": len(open_side),
        "ceiling_plane": layout["ceiling_plane"],
        "wall_s": measure["wall_s"],
        "peak_gb": measure.get("peak_footprint_gb") or run_info.get("mlx_peak_gb"),
        "exit_code": measure["exit_code"],
        "info": run_info,
    }
    (run_dir / "score.json").write_text(json.dumps(result, indent=2))
    plot_topdown(scene=scene, layout=layout, walls=walls, path=run_dir / "topdown.png", title=f"{result['model']} / {result['run']}")
    return result


def err(value, ref):
    return f"{value:.2f} ({100 * (value / ref - 1):+.0f}%)"


def passes(*, room, r):
    ok_room = all(abs(room[k] / REF[k] - 1) <= PASS_ERR for k in REF)
    return ok_room and r["wall_s"] < PASS_TIME_S and (r["peak_gb"] or 99) < PASS_PEAK_GB


def print_table(results):
    piece = PICKS["scale_piece"]
    head = ["model", "run", "reg", "W m", "L m", "H m", "scale", f"W m ({piece})", f"L m ({piece})", f"H m ({piece})",
            "other pieces", "planes", "open", "time s", "peak GB", "pass metric", f"pass {piece}"]
    rows = []
    for r in results:
        m = r["metric"]
        walls = ",".join(k for k, v in r["walls"].items() if v["plane"]) + ("" if r["ceiling_plane"] else " (ceil: no plane)")
        row = [r["model"], r["run"], f"{r['registered']}/{r['views']}", err(m["width"], REF["width"]), err(m["length"], REF["length"]), err(m["ceiling"], REF["ceiling"])]
        s = r["scaled"].get(piece)
        if s:
            room = s["room"]
            others = " ".join(f"{k} {100 * v:+.0f}%" for k, v in s["furniture_err"].items())
            row += [f"x{s['k']:.3f}", err(room["width"], REF["width"]), err(room["length"], REF["length"]), err(room["ceiling"], REF["ceiling"]), others]
        else:
            row += ["n/a"] * 5
        row += [walls, str(r["open_side_planes"]), f"{r['wall_s']:.0f}", f"{r['peak_gb']:.1f}" if r["peak_gb"] else "?",
                "yes" if passes(room=m, r=r) else "no", "yes" if s and passes(room=s["room"], r=r) else "no"]
        rows.append(row)
    widths = [max(len(str(x)) for x in col) for col in zip(head, *rows)]
    for row in [head, ["-" * w for w in widths], *rows]:
        print(" | ".join(str(x).ljust(w) for x, w in zip(row, widths)))
    print()
    print("Leave-one-out: room and the other pieces after scaling from each piece")
    for r in results:
        for p, s in r["scaled"].items():
            room = s["room"]
            others = " ".join(f"{k} {100 * v:+.0f}%" for k, v in s["furniture_err"].items())
            print(f"  {r['model']}/{r['run']} scale={p:6s} W {err(room['width'], REF['width'])}  L {err(room['length'], REF['length'])}  H {err(room['ceiling'], REF['ceiling'])}  {others}")
        missing = set(PICKS["furniture"]) - set(r["furniture_m"])
        if missing:
            print(f"  {r['model']}/{r['run']} not measurable (pick outside the model's crop or not in its mask): {', '.join(sorted(missing))}")


def main():
    run_dirs = sorted(p.parent for p in (OUT_DIR / "runs").glob("*/*/measure.json"))
    if not run_dirs:
        print(f"no runs under {OUT_DIR / 'runs'}", file=sys.stderr)
        return 1
    results, failures = [], []
    for run_dir in run_dirs:
        if json.loads((run_dir / "measure.json").read_text())["exit_code"] != 0:
            failures.append(f"{run_dir.parent.name}/{run_dir.name}: model run failed, see {run_dir / 'stderr.log'}")
            continue
        try:
            results.append(score_run(run_dir))
        except (OSError, KeyError, ValueError, IndexError) as exc:
            failures.append(f"{run_dir.parent.name}/{run_dir.name}: {exc!r}")
    print_table(results)
    for line in failures:
        print(f"FAILED {line}")
    return 1 if failures or not results else 0


if __name__ == "__main__":
    sys.exit(main())
