"""Run a command under `/usr/bin/time -l` and write its wall time and peak memory to `measure.json`.

Usage: measure.py <out_dir> <timeout_s> <command> [args...]
Pass the venv's python directly, not `uv run`, so the numbers are the model process's own.
"""

import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path


def main():
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    timeout_s = float(sys.argv[2])
    command = sys.argv[3:]
    proc = subprocess.Popen(["/usr/bin/time", "-l", *command], stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stderr = proc.communicate(timeout=timeout_s)[1]
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        stderr = proc.communicate()[1] + f"\ntimed out after {timeout_s} s\n"
        exit_code = 124
    wall_s = time.monotonic() - start
    sys.stderr.write(stderr)
    (out_dir / "stderr.log").write_text(stderr)
    footprint = re.search(r"(\d+)\s+peak memory footprint", stderr)
    rss = re.search(r"(\d+)\s+maximum resident set size", stderr)
    result = {
        "command": command,
        "exit_code": exit_code,
        "wall_s": wall_s,
        "peak_footprint_gb": int(footprint.group(1)) / 1e9 if footprint else None,
        "max_rss_gb": int(rss.group(1)) / 1e9 if rss else None,
    }
    (out_dir / "measure.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
