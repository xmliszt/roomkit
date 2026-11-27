#!/usr/bin/env bash
# Screenshot a GLB in three.js with the editor's lighting: preview.sh --glb <file> --out <png> [options]
set -euo pipefail
# Each screenshot of a job's model is also kept in <job>/.rounds/.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$HERE/preview.ts" "$@"
glb="" out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --glb) glb="$2"; shift ;;
    --out) out="$2"; shift ;;
  esac
  shift
done
if [ -n "$glb" ] && [ -n "$out" ] && [ -f "$(dirname "$glb")/job.json" ]; then
  mkdir -p "$(dirname "$glb")/.rounds"
  cp "$out" "$(dirname "$glb")/.rounds/$(date +%H%M%S)-$(basename "$out")"
fi
