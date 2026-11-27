#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
repo_dir="$PWD"
version="${ROOMKIT_VERSION:-0.1.0}"
output_dir="${ROOMKIT_OUTPUT_DIR:-$repo_dir/dist}"
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  printf '%s\n' 'Build on an Apple silicon Mac.' >&2
  exit 1
fi
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  printf '%s\n' 'ROOMKIT_VERSION must be a three-part version such as 0.1.0.' >&2
  exit 1
fi
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
dmg="$output_dir/Roomkit-$version-arm64.dmg"
if [[ -e "$dmg" ]]; then
  printf 'Remove or move the existing disk image before rebuilding: %s\n' "$dmg" >&2
  exit 1
fi
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
app="$stage/disk/Roomkit.app"
helpers="$app/Contents/Helpers"
resources="$app/Contents/Resources"
runtime="$resources/runtime"
frameworks="$app/Contents/Frameworks"
sparkle="$stage/sparkle"
mkdir -p "$app/Contents/MacOS" "$helpers" "$resources/web" "$runtime" "$stage/download" "$frameworks" "$sparkle"

node_archive="node-v24.22.1-darwin-arm64.tar.gz"
node_hash=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7
curl --proto '=https' --fail --silent --show-error --location --retry 2 --output "$stage/download/$node_archive" "https://nodejs.org/dist/v24.22.1/$node_archive"
(
  cd "$stage/download"
  printf '%s  %s\n' "$node_hash" "$node_archive" | shasum -a 256 --check
  tar -xzf "$node_archive" --strip-components=1 -C . "node-v24.22.1-darwin-arm64/bin/node" "node-v24.22.1-darwin-arm64/LICENSE"
)
cp "$stage/download/bin/node" "$helpers/node"
cp "$stage/download/LICENSE" "$resources/Node-LICENSE.txt"
cp LICENSE "$resources/Roomkit-LICENSE.txt"
cp desktop/{ports,server,watch-parent}.mjs "$resources/"
cp desktop/native-messages.json "$resources/"
cp -R desktop/permissions/*.lproj "$resources/"
cp desktop/Info.plist "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" -c "Set :CFBundleVersion $version" "$app/Contents/Info.plist"
desktop/download-sparkle.sh "$sparkle"
ditto "$sparkle/Sparkle.framework" "$frameworks/Sparkle.framework"
cp "$sparkle/LICENSE" "$resources/Sparkle-LICENSE.txt"
xcrun swiftc -O -parse-as-library -target arm64-apple-macos15.0 \
  -F "$frameworks" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  desktop/Roomkit.swift desktop/RoomkitWindow.swift desktop/RoomkitLocalization.swift -o "$app/Contents/MacOS/Roomkit"

iconset="$stage/Roomkit.iconset"
mkdir "$iconset"
sips -s format png marketing/roomkit/assets/roomkit.ico --out "$stage/icon.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$stage/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$stage/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$resources/Roomkit.icns" "$iconset"

web_port="$(node --input-type=module -e 'import { webPort } from "./desktop/ports.mjs"; process.stdout.write(String(webPort))')"
ROOMKIT_DESKTOP_BUILD=1 PLANNER_WEB_PORT="$web_port" NEXT_TELEMETRY_DISABLED=1 pnpm -F @planner/web build
cp -R apps/web/.next/standalone/. "$resources/web/"
cp -R apps/web/.next/static "$resources/web/apps/web/.next/static"
cp -R apps/web/public "$resources/web/apps/web/public"

cp package.json pnpm-{lock.yaml,workspace.yaml} "$runtime/"
for workspace in apps/web packages/daemon packages/mcp packages/shared; do
  mkdir -p "$runtime/$workspace"
  cp "$workspace/package.json" "$runtime/$workspace/"
done
for workspace in packages/daemon packages/mcp packages/shared; do
  rsync -a --exclude '*.test.ts' "$workspace/src/" "$runtime/$workspace/src/"
done
cp -R packages/daemon/{catalog,sample-room} "$runtime/packages/daemon/"
mkdir -p "$runtime/python" "$runtime/blender/procedural"
cp python/{pyproject.toml,uv.lock} "$runtime/python/"
rsync -a --exclude __pycache__ python/workers/ "$runtime/python/workers/"
cp blender/*.py "$runtime/blender/"
cp blender/procedural/{modeler_lib,surfacer_lib}.py "$runtime/blender/procedural/"
cp -R roles "$runtime/"
mkdir "$runtime/scripts"
cp scripts/machine-lock.sh "$runtime/scripts/"
(
  cd "$runtime"
  pnpm --filter @planner/daemon... install --prod --frozen-lockfile --ignore-scripts --package-import-method=copy
)
rm -rf "$runtime/apps"

ln -s /Applications "$stage/disk/Applications"
hdiutil create -fs HFS+ -format UDZO -volname Roomkit -srcfolder "$stage/disk" "$stage/Roomkit.dmg"
mv "$stage/Roomkit.dmg" "$dmg"
printf 'Built %s\n' "$dmg"
