"""Run blender/normalize.py on every raw.glb under outputs/ for generators with measured axes, writing model.glb and normalize.json beside it.

Usage: uv run --project python/spikes/s2 python python/spikes/s2/normalize_all.py [model ...]
"""

import json
import os
import subprocess
import sys

from paths import HERE, OUT, input_by_id

REPO = HERE.parents[2]
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
generators = json.loads((HERE / "generators.json").read_text())

measured = sorted(name for name, meta in generators.items() if "up" in meta)
unmeasured = [model for model in sys.argv[1:] if model not in measured]
if unmeasured:
    sys.exit(f"no measured axes for {', '.join(unmeasured)}")
for model in sys.argv[1:] or measured:
    axes = generators[model]
    for raw in sorted((OUT / model).glob("*/raw.glb")):
        spec = input_by_id(raw.parent.name)
        command = [
            BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", str(REPO / "blender/normalize.py"), "--",
            "--input", str(raw), "--output", str(raw.parent / "model.glb"), "--mount", "floor",
            f"--expected-size={max(spec['sizeM'].values())}",
            f"--source-up={axes['up']}", f"--source-front={axes['front']}",
        ]
        run = subprocess.run(command, capture_output=True, text=True)
        line = next((text for text in run.stdout.splitlines() if text.startswith("RESULT ")), None)
        if run.returncode != 0 or line is None:
            print(f"{model} {spec['id']}: normalize failed\n{run.stdout[-2000:]}{run.stderr[-2000:]}")
            continue
        (raw.parent / "normalize.json").write_text(line.removeprefix("RESULT "))
        print(f"{model} {spec['id']}: {line.removeprefix('RESULT ')}")
