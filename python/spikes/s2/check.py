"""S2 gate: check saved outputs against the PLAN 5.1 gate, print the table, regenerate the sheets and the viewer.

Usage: uv run --project python/spikes/s2 python python/spikes/s2/check.py
Reads outputs/<model>/<input>/{model.glb,metrics.json} and S7's viewer GLBs; never reruns a generator.
"""

import json
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import ConvexHull

from paths import HERE, OUT, PRODUCTS, RESULTS, S3_SETS, S7_RESULTS, SPIKE, load_inputs

MAX_TRIANGLES = 150_000
MAX_BYTES = 25 * 1024 * 1024
MAX_TEXTURE_PX = 2048
PROPORTION_TOLERANCE = 0.2
MAX_SECONDS = 600
MAX_PEAK_GB = 24
TILE_PX = 320
BACKGROUND = (244, 241, 234)

generators = json.loads((HERE / "generators.json").read_text())
chosen = json.loads((HERE / "chosen.json").read_text())
inputs = load_inputs()


def footprint_dims(points):
    """Return the long and short side of the minimum-area rectangle around the points' floor projection."""
    xz = np.asarray(points)[:, [0, 2]]
    hull = xz[ConvexHull(xz).vertices]
    edges = np.diff(np.vstack([hull, hull[:1]]), axis=0)
    best = None
    for angle in np.arctan2(edges[:, 1], edges[:, 0]):
        rotation = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
        extent = np.ptp(hull @ rotation.T, axis=0)
        if best is None or extent[0] * extent[1] < best[0] * best[1]:
            best = extent
    return sorted(best, reverse=True)


def proportion_check(spec, inspection):
    expected = spec["sizeM"]
    height = inspection["size"][1]
    long_side, short_side = footprint_dims(inspection["points"])
    measured = {"height": height, "long": long_side, "short": short_side}
    if "width" not in expected:
        return {"ok": None, "measured": measured, "note": f"no footprint reference; footprint {long_side:.2f} x {short_side:.2f} m"}
    wanted = {"height": expected["height"], "long": max(expected["width"], expected["depth"]), "short": min(expected["width"], expected["depth"])}
    errors = {key: measured[key] / wanted[key] - 1 for key in wanted}
    return {"ok": all(abs(error) <= PROPORTION_TOLERANCE for error in errors.values()), "measured": measured, "errors": errors}


def glb_tool(jobs):
    if not (HERE / "web/node_modules").is_dir():
        subprocess.run(["pnpm", "install", "--ignore-workspace", "--frozen-lockfile"], cwd=HERE / "web", check=True)
        subprocess.run(["pnpm", "exec", "playwright", "install", "chromium"], cwd=HERE / "web", check=True)
    tmp = SPIKE / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "jobs.json").write_text(json.dumps(jobs))
    subprocess.run(["node", str(HERE / "web/glb-tool.ts"), str(tmp / "jobs.json"), str(tmp / "result.json")], check=True)
    return json.loads((tmp / "result.json").read_text())


S7 = "s7"
s7_objects = json.loads((S7_RESULTS / "viewer/objects.json").read_text()) if (S7_RESULTS / "viewer/objects.json").is_file() else []
gate_failures = [f"{key}: unknown choice {value!r}" for key, value in chosen.items() if value != S7 and value not in generators]
gate_failures += [f"{spec['id']}: no choice in chosen.json" for spec in inputs if spec["id"] not in chosen]

rows = []
for spec in (spec for spec in inputs if chosen.get(spec["id"]) == S7):
    s7 = next((item for item in s7_objects if item["name"] == spec.get("s7")), None)
    if s7 is None:
        gate_failures.append(f"{spec['id']}: chosen for S7, but S7 has no model for it")
        continue
    rows.append({"is_chosen": True, "model": S7, "label": "S7 agent + Blender", "spec": spec, "folder": None, "metrics": None, "glb": S7_RESULTS / "viewer" / s7["file"]})
for model, meta in generators.items():
    for spec in inputs:
        folder = OUT / model / spec["id"]
        metrics_path = folder / "metrics.json"
        metrics = json.loads(metrics_path.read_text()) if metrics_path.is_file() else None
        is_chosen = chosen.get(spec["id"]) == model
        if metrics is None and not is_chosen:
            continue
        rows.append({"is_chosen": is_chosen, "model": model, "label": meta["label"], "spec": spec, "folder": folder, "metrics": metrics, "glb": folder / "model.glb"})

present = [row for row in rows if row["glb"].is_file()]
inspected = glb_tool({"inspect": [{"id": f"{row['model']}/{row['spec']['id']}", "glb": str(row["glb"])} for row in present]})["inspect"]

table = []
for row in rows:
    spec, metrics = row["spec"], row["metrics"]
    is_chosen = row["is_chosen"]
    inspection = inspected.get(f"{row['model']}/{spec['id']}")
    if inspection is None or not inspection.get("loaded"):
        reason = "no output" if metrics is None else (metrics.get("blocker") or {}).get("reason", "no model.glb")
        table.append((row["label"] + (" *" if is_chosen else ""), spec["id"], "-", "-", "-", "-", "-", "-", "FAIL", str(reason)[:70], "no"))
        if is_chosen:
            gate_failures.append(f"{row['model']} {spec['id']}: {reason}")
        continue
    proportions = proportion_check(spec, inspection)
    texture_px = max((max(texture["width"], texture["height"]) for texture in inspection["textures"]), default=0)
    checks = {
        "validator": inspection["validatorErrors"] == 0,
        "proportions": proportions["ok"] is not False,
        "triangles": inspection["triangles"] <= MAX_TRIANGLES,
        "file": inspection["bytes"] <= MAX_BYTES,
        "texture": 0 < texture_px <= MAX_TEXTURE_PX,
    }
    bar = {} if metrics is None else {
        "time": metrics["totalS"] <= MAX_SECONDS,
        "memory": max(metrics["peakRssGb"], metrics["peakGpuGb"]) < MAX_PEAK_GB,
    }
    row["inspection"], row["proportions"], row["checks"] = inspection, proportions, checks
    failed = [name for name, ok in checks.items() if not ok]
    missed_bar = [name for name, ok in bar.items() if not ok]
    errors = proportions.get("errors", {})
    proportion_text = " ".join(f"{key} {error:+.0%}" for key, error in errors.items()) or proportions.get("note", "")
    table.append((
        row["label"] + (" *" if is_chosen else ""),
        spec["id"],
        "-" if metrics is None else f"{metrics['totalS']:.0f}",
        "-" if metrics is None else f"{max(metrics['peakRssGb'], metrics['peakGpuGb']):.1f}",
        f"{inspection['triangles']:,}",
        f"{inspection['bytes'] / 1e6:.1f}",
        str(texture_px),
        proportion_text,
        "pass" if not failed else "FAIL",
        ", ".join(failed),
        "n/a" if metrics is None else "yes" if not missed_bar else "over " + ", ".join(missed_bar),
    ))
    if is_chosen and failed:
        gate_failures.append(f"{row['model']} {spec['id']}: {', '.join(failed)}")

header = ("model", "input", "time s", "peak GB", "triangles", "MB", "tex px", "proportions", "5.1 gate", "failed checks", "S2 bar (10 min, 24 GB)")
widths = [max(len(str(line[index])) for line in [header, *table]) for index in range(len(header))]
for line in [header, *table]:
    print("  ".join(str(cell).ljust(width) for cell, width in zip(line, widths)))
loaded = [value for value in inspected.values() if value.get("loaded")]
print(f"validator: {sum(value['validatorErrors'] for value in loaded)} errors, {sum(value['validatorWarnings'] for value in loaded)} warnings across {len(loaded)} GLBs")
print("* chosen for that input in chosen.json; inputs chosen for S7: " + ", ".join(key for key, value in chosen.items() if value == S7))


def shots_for(row):
    view = row["spec"]["view"]
    yaw = generators[row["model"]].get("yawDeg", {}).get(row["spec"]["id"], 0)
    return [
        {"glb": str(row["glb"]), "out": str(row["folder"] / f"shot-{name}.png"), "environment": environment,
         "azimuthDeg": view["azimuthDeg"], "elevationDeg": view["elevationDeg"], "yawDeg": yaw}
        for name, environment in (("plain", False), ("env", True))
    ]


generated = [row for row in rows if row["model"] != S7]
glb_tool({"shots": [shot for row in generated if "inspection" in row for shot in shots_for(row)]})

try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except OSError:
    font = ImageFont.load_default()


def tile(path, label):
    canvas = Image.new("RGB", (TILE_PX, TILE_PX + 28), BACKGROUND)
    if path is not None and path.is_file():
        image = Image.open(path).convert("RGBA")
        image.thumbnail((TILE_PX, TILE_PX))
        flat = Image.new("RGBA", image.size, BACKGROUND + (255,))
        flat.alpha_composite(image)
        canvas.paste(flat.convert("RGB"), ((TILE_PX - image.width) // 2, 28 + (TILE_PX - image.height) // 2))
    else:
        ImageDraw.Draw(canvas).text((TILE_PX // 2, TILE_PX // 2), "none", fill=(150, 145, 135), font=font, anchor="mm")
    ImageDraw.Draw(canvas).text((8, 6), label, fill=(43, 42, 39), font=font)
    return canvas


def sheet(kind, shot_name, path):
    lines = []
    for spec in (spec for spec in inputs if spec["kind"] == kind):
        source = S3_SETS / spec["id"] / "crop.png" if kind == "in-room" else PRODUCTS / spec["image"]
        tiles = [tile(source, spec["label"])]
        if kind == "in-room":
            s7_name = spec.get("s7")
            s7_shot = {"plain": "shot-plain.png", "env": "shot-environment.png"}[shot_name]
            tiles.append(tile(S7_RESULTS / "models" / s7_name / s7_shot if s7_name else None, "S7 agent + Blender"))
        tiles += [tile(OUT / model / spec["id"] / f"shot-{shot_name}.png", meta["label"]) for model, meta in generators.items()]
        lines.append(tiles)
    columns = max(len(line) for line in lines)
    image = Image.new("RGB", (columns * TILE_PX, len(lines) * (TILE_PX + 28)), BACKGROUND)
    for row_index, line in enumerate(lines):
        for column, part in enumerate(line):
            image.paste(part, (column * TILE_PX, row_index * (TILE_PX + 28)))
    image.save(path)


RESULTS.mkdir(parents=True, exist_ok=True)
sheet("in-room", "plain", RESULTS / "compare.png")
sheet("in-room", "env", RESULTS / "compare-env.png")
sheet("product", "plain", RESULTS / "compare-products.png")
sheet("product", "env", RESULTS / "compare-products-env.png")

viewer = RESULTS / "viewer"
shutil.rmtree(viewer, ignore_errors=True)
viewer.mkdir()
shutil.copy(HERE / "web/viewer.html", viewer / "index.html")
shutil.copy(HERE / "web/stage.js", viewer / "stage.js")


def size_cm(size):
    return " × ".join(f"{value * 100:.0f}" for value in (size[0], size[2], size[1]))


entries = []


def add_s7(s7, group):
    file = f"s7-{s7['file']}"
    shutil.copy(S7_RESULTS / "viewer" / s7["file"], viewer / file)
    entries.append({**s7, "group": group, "label": "S7 agent + Blender", "file": file})


for spec in inputs:
    s7 = next((item for item in s7_objects if item["name"] == spec.get("s7")), None)
    if s7 is not None:
        add_s7(s7, spec["label"])
    for row in (row for row in generated if row["spec"]["id"] == spec["id"] and "inspection" in row):
        file = f"{row['model']}-{spec['id']}.glb"
        shutil.copy(row["glb"], viewer / file)
        inspection = row["inspection"]
        entries.append({
            "name": f"{row['model']}-{spec['id']}", "group": spec["label"], "label": row["label"], "mount": "floor", "file": file,
            "sizeCm": size_cm(inspection["size"]), "triangleCount": int(inspection["triangles"]), "sizeKb": round(inspection["bytes"] / 1024),
            "yawDeg": generators[row["model"]].get("yawDeg", {}).get(spec["id"], 0),
        })
paired = {spec.get("s7") for spec in inputs}
for s7 in s7_objects:
    if s7["name"] not in paired:
        add_s7(s7, f"{s7['label']} (S7 only)")
(viewer / "objects.json").write_text(json.dumps(entries, indent=2))
print(f"wrote {RESULTS}/compare.png, compare-products.png (and -env variants), viewer/ with {len(entries)} models")

if gate_failures:
    print("S2 gate: FAIL\n  " + "\n  ".join(gate_failures))
    sys.exit(1)
print("S2 gate: PASS")
