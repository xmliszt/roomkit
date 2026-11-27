#!/usr/bin/env bash
# S7 gate: check every final GLB in $S7_RESULTS/models (three.js r187 load at the expected size within 1 mm,
# 0 validator errors, M3 budgets), then regenerate compare.png and the viewer from the saved GLBs and
# screenshots. It does not rerun the modeler agents; promote.sh puts their models in place.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
S7_HOME="${S7_HOME:-$HOME/.cache/interior-planner-spikes/s7}"
S7_RESULTS="${S7_RESULTS:-$S7_HOME/results}"
S7_PHOTOS="${S7_PHOTOS:-$S7_HOME/photos}"
SOURCE_PHOTOS="${S7_SOURCE_PHOTOS:-$HOME/Downloads/Room}"
PYTHON="$REPO/python/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "Python env missing. Run: (cd $REPO/python && uv sync)" >&2
  exit 1
fi

"$PYTHON" -I "$HERE/convert_photos.py" --source "$SOURCE_PHOTOS" --output "$S7_PHOTOS"
"$PYTHON" -I "$HERE/compose.py" --photos "$S7_PHOTOS" --models "$S7_RESULTS/models" --output "$S7_RESULTS/compare.png"

cd "$HERE"
pnpm install --ignore-workspace --frozen-lockfile --silent
pnpm exec playwright install chromium-headless-shell >/dev/null
node s7-check.ts "$S7_RESULTS"
