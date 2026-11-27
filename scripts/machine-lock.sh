#!/bin/zsh
# Run a command while holding the one machine-wide lock for measured runs (ML, Blender, weight downloads).
# Usage: scripts/machine-lock.sh <label> <command> [args...]
set -u
label="$1"; shift
lock="${PLANNER_MACHINE_LOCK:-$HOME/.cache/interior-planner-machine.lock}"
mkdir -p "${lock:h}"
until mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/holder" 2>/dev/null)
  pid=${holder%% *}
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$lock"
    continue
  fi
  echo "machine-lock: waiting for ${holder:-unknown}" >&2
  sleep 30
done
echo "$$ $label $(date +%H:%M:%S)" > "$lock/holder"
trap 'rm -rf "$lock"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo 'machine-lock: acquired' >&2
"$@"
