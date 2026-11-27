"""Render the DESIGN 6 line test on generated GLBs: EdgesGeometry, proxy-mesh creases and a screen-space edge pass at DPR 2.

Usage: uv run --project python/spikes/s2 python python/spikes/s2/lines_test.py
Writes results/lines/<input>-<mode>.png, result.json (timings) and lines-compare.png.
"""

import json
import subprocess
import sys

from PIL import Image

from paths import HERE, OUT, RESULTS, input_by_id

INPUT_IDS = ("fridge", "p_side_table")
MODES = ("edges-geometry", "proxy", "screen")
TILE_PX = 500

folder = RESULTS / "lines"
folder.mkdir(parents=True, exist_ok=True)
jobs = []
for input_id in INPUT_IDS:
    glb = OUT / "trellis2" / input_id / "model.glb"
    subprocess.run([sys.executable, str(HERE / "proxy_lines.py"), str(glb), str(folder / f"{input_id}-lines.json")], check=True)
    view = input_by_id(input_id)["view"]
    jobs += [
        {"glb": str(glb), "lines": str(folder / f"{input_id}-lines.json"), "out": str(folder / f"{input_id}-{mode}.png"), "mode": mode, **view}
        for mode in MODES
    ]
(folder / "jobs.json").write_text(json.dumps({"lines": jobs}))
subprocess.run(["node", str(HERE / "web/glb-tool.ts"), str(folder / "jobs.json"), str(folder / "result.json")], check=True)
print("\n".join(json.loads((folder / "result.json").read_text())["shots"]))

sheet = Image.new("RGB", (len(MODES) * TILE_PX, len(INPUT_IDS) * TILE_PX))
for row, input_id in enumerate(INPUT_IDS):
    for column, mode in enumerate(MODES):
        sheet.paste(Image.open(folder / f"{input_id}-{mode}.png").convert("RGB").resize((TILE_PX, TILE_PX)), (column * TILE_PX, row * TILE_PX))
sheet.save(folder / "lines-compare.png")
