#!/usr/bin/env bash
# Ask a fresh agent, given only the photo crop and the three.js screenshot, to list the differences:
# run-critic.sh <object> [plain|environment]   (reads shot-<variant>.png in $S7_RESULTS/models/<object>/, writes
# critic.md, or critic-environment.md, beside it)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S7_HOME="${S7_HOME:-$HOME/.cache/interior-planner-spikes/s7}"
RESULTS="${S7_RESULTS:-$S7_HOME/results}"
PHOTOS="${S7_PHOTOS:-$S7_HOME/photos}"
PYTHON="$(cd "$HERE/../.." && pwd)/python/.venv/bin/python"
name="$1"
variant="${2:-plain}"
report="critic.md"
[ "$variant" = environment ] && report="critic-environment.md"
folder="$S7_HOME/critics/$name-$(date +%H%M%S)"
mkdir -p "$folder"
"$PYTHON" -I - "$HERE/objects.json" "$name" "$PHOTOS" "$folder/photo.jpg" <<'PY'
import json, sys
from PIL import Image
spec = next(o for o in json.load(open(sys.argv[1]))["objects"] if o["name"] == sys.argv[2])
photo = Image.open(f"{sys.argv[3]}/{spec['bestPhoto']}.jpg")
x0, y0, x1, y1 = spec["box"]
photo.crop((round(x0 * photo.width), round(y0 * photo.height), round(x1 * photo.width), round(y1 * photo.height))).save(sys.argv[4], quality=90)
PY
cp "$RESULTS/models/$name/shot-$variant.png" "$folder/model.png"
cd "$folder"
claude -p "Compare photo.jpg with model.png as your instructions say." \
  --model opus \
  --append-system-prompt-file "$HERE/critic.md" \
  --output-format json \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources project \
  --permission-mode dontAsk \
  --tools Read \
  --allowedTools "Read(/$folder/**)" \
  </dev/null >"$folder/result.json"
python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["result"])' "$folder/result.json" >"$RESULTS/models/$name/$report"
cat "$RESULTS/models/$name/$report"
