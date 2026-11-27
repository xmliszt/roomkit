"""Run one generator script per input in its own process, stopping a run at 20 minutes.

Usage (measured runs take the machine lock):
  scripts/machine-lock.sh s2 uv run --project python/spikes/s2 python python/spikes/s2/run.py gen_trellis.py [ids...] [-- extra args]
"""

import subprocess
import sys
import time

from paths import HERE, load_inputs

STOP_AFTER_S = 20 * 60

argv = sys.argv[1:]
extra = argv[argv.index("--") + 1 :] if "--" in argv else []
argv = argv[: argv.index("--")] if "--" in argv else argv
script, *ids = argv
ids = ids or [item["id"] for item in load_inputs()]

failures = []
for input_id in ids:
    start = time.perf_counter()
    try:
        code = subprocess.run([sys.executable, str(HERE / script), input_id, *extra], timeout=STOP_AFTER_S).returncode
    except subprocess.TimeoutExpired:
        code = "stopped at 20 min"
    print(f"{script} {input_id}: exit {code} after {time.perf_counter() - start:.0f} s", flush=True)
    if code != 0:
        failures.append(input_id)
print(f"failed: {failures}" if failures else "all ran")
