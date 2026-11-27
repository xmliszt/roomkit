#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_DIR="$(dirname "$SPIKE_DIR")"
FIXTURES="$BLENDER_DIR/fixtures"
OUT="$SPIKE_DIR/out"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
RECOLOR="#1E50E6"

if [ ! -x "$BLENDER" ]; then
  echo "Blender not found at $BLENDER. Install it with: /opt/homebrew/bin/brew install --cask blender" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/logs"

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

run_blender() {
  local label="$1" script="$2"
  shift 2
  local log="$OUT/logs/$label.log" start
  start="$(now)"
  if ! "$BLENDER" --background --factory-startup --python-exit-code 1 --python "$script" -- "$@" >"$log" 2>&1; then
    echo "FAIL $label" >&2
    tail -n 30 "$log" >&2
    exit 1
  fi
  printf '%-28s %6.2f s  %s\n' "$label" "$(echo "$(now) - $start" | bc)" "$(grep '^RESULT ' "$log" || true)"
}

run_case() {
  local name="$1" source="$2" mount="$3" expected_size="$4" up="$5" front="$6"
  local dir="$OUT/$name"
  mkdir -p "$dir"
  printf '{"name":"%s","source":"%s","mount":"%s","expectedSizeM":%s,"sourceUp":"%s","sourceFront":"%s"}\n' \
    "$name" "$source" "$mount" "$expected_size" "$up" "$front" >"$dir/case.json"
  local source_path="$FIXTURES/$source"
  if [[ "$source" == out/* ]]; then source_path="$SPIKE_DIR/$source"; fi
  run_blender "$name.normalize" "$BLENDER_DIR/normalize.py" --input "$source_path" --output "$dir/model.glb" \
    --mount "$mount" --expected-size "$expected_size" --source-up="$up" --source-front="$front"
  local reference_luma
  reference_luma="$(node -e 'const fs=require("fs");const line=fs.readFileSync(process.argv[1],"utf8").split("\n").find(v=>v.startsWith("RESULT "));console.log(JSON.parse(line.slice(7)).referenceLuma)' "$OUT/logs/$name.normalize.log")"
  run_blender "$name.recolor" "$BLENDER_DIR/recolor.py" --input "$dir/model.glb" --output "$dir/recolored.glb" \
    --color "$RECOLOR" --strength 1 --reference-luma "$reference_luma"
  run_blender "$name.thumbnail" "$BLENDER_DIR/thumbnail.py" --input "$dir/recolored.glb" --output "$dir/thumb.png"
}

"$BLENDER" --version | sed -n 1p
echo "binary: $BLENDER"

if [ ! -f "$FIXTURES/chair-wrong-axes.glb" ]; then
  run_blender "build-fixture" "$FIXTURES/build_fixture.py" --output "$FIXTURES/chair-wrong-axes.glb"
fi

if [ ! -f "$FIXTURES/chair-jpeg-texture.glb" ]; then
  run_blender "build-jpeg-fixture" "$FIXTURES/build_fixture.py" --output "$FIXTURES/chair-jpeg-texture.glb" \
    --image-format JPEG
fi

run_case chair-floor chair-wrong-axes.glb floor 0.9 +Z +X
run_case chair-wall chair-wrong-axes.glb wall 0.9 +Z +X
run_case chair-ceiling chair-wrong-axes.glb ceiling 0.9 +Z +X
run_case chair-jpeg-floor chair-jpeg-texture.glb floor 0.9 +Z +X
run_case duck-floor duck.glb floor 0.25 +Y +X
run_blender build-m3-fixtures "$BLENDER_DIR/tests/build-fixtures.py" --output "$OUT/fixtures"
run_case white-floor out/fixtures/white.glb floor 0.9 +Y +Z
run_case black-floor out/fixtures/black.glb floor 0.9 +Y +Z

cd "$SPIKE_DIR"
pnpm install --ignore-workspace --frozen-lockfile --silent
pnpm exec playwright install chromium-headless-shell >/dev/null
echo
node s4-check.ts "$OUT" chair-floor chair-wall chair-ceiling chair-jpeg-floor duck-floor white-floor black-floor
