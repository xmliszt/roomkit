#!/usr/bin/env bash
# Make a cold run's model final: promote.sh <object> <job dir>
# Normalizes raw.glb, takes the three.js screenshots from the object's view in objects.json (without and with
# the environment map), and copies the agent's notes, into $S7_RESULTS/models/<object>/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_DIR="$(dirname "$HERE")"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
S7_HOME="${S7_HOME:-$HOME/.cache/interior-planner-spikes/s7}"
RESULTS="${S7_RESULTS:-$S7_HOME/results}"
PHOTOS="${S7_PHOTOS:-$S7_HOME/photos}"
name="$1"
job="$(cd "$2" && pwd)"
dir="$RESULTS/models/$name"
mkdir -p "$dir"

read -r mount largest azimuth elevation width height < <(python3 - "$HERE/objects.json" "$name" "$PHOTOS" <<'PY'
import json, struct, sys
spec = next(o for o in json.load(open(sys.argv[1]))["objects"] if o["name"] == sys.argv[2])
data = open(f"{sys.argv[3]}/{spec['bestPhoto']}.jpg", "rb").read()
offset = 2
while True:
    marker, length = data[offset + 1], struct.unpack(">H", data[offset + 2 : offset + 4])[0]
    if marker in (0xC0, 0xC2):
        photo_height, photo_width = struct.unpack(">HH", data[offset + 5 : offset + 9])
        break
    offset += 2 + length
x0, y0, x1, y1 = spec["box"]
aspect = (x1 - x0) * photo_width / ((y1 - y0) * photo_height)
height = 800
print(spec["mount"], max(spec["sizeM"].values()), spec["view"]["azimuthDeg"], spec["view"]["elevationDeg"], round(height * aspect), height)
PY
)

"$BLENDER" --background --factory-startup --python-exit-code 1 \
  --python "$BLENDER_DIR/normalize.py" -- --input "$job/raw.glb" --output "$dir/model.glb" --mount "$mount" \
  --expected-size "$largest" >"$dir/normalize.log" 2>&1 || { tail -n 20 "$dir/normalize.log" >&2; exit 1; }
for variant in plain environment; do
  flag=()
  [ "$variant" = environment ] && flag=(--environment)
  node "$HERE/preview.ts" --glb "$dir/model.glb" --out "$dir/shot-$variant.png" --azimuth "$azimuth" \
    --elevation "$elevation" --size "${width}x${height}" --mount "$mount" ${flag[@]+"${flag[@]}"} >/dev/null
done
cp "$job/notes.md" "$dir/notes.md" 2>/dev/null || true
cp "$job/model.py" "$dir/model.py"
echo "$job" >"$dir/source-job.txt"
echo "promoted $name from $job"
