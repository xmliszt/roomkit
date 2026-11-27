#!/bin/bash
set -euo pipefail

if [[ -z "${1:-}" || -n "${2:-}" ]]; then
  printf '%s\n' 'Usage: desktop/smoke-dmg.sh path/to/Roomkit.dmg' >&2
  exit 1
fi
stage="$(mktemp -d)"
mounted=false
server_pid=
cleanup() {
  if [[ -n "$server_pid" ]]; then
    stop_roomkit || true
  fi
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$stage/volume" -quiet || return 1
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
hdiutil attach "$1" -readonly -nobrowse -mountpoint "$stage/volume" -quiet
mounted=true
ditto "$stage/volume/Roomkit.app" "$stage/Installed Apps/Roomkit.app"
hdiutil detach "$stage/volume" -quiet
mounted=false
app="$stage/Installed Apps/Roomkit.app"
node="$app/Contents/Helpers/node"
resources="$app/Contents/Resources"
test -s "$resources/Roomkit-LICENSE.txt"
function launch_roomkit() {
  : > "$stage/startup.log"
  TMPDIR="$stage" PLANNER_HOME="$stage/data" PLANNER_PROJECTS="$stage/projects" \
    PLANNER_CLAUDE_BIN="$stage/no-claude" PLANNER_CODEX_BIN="$stage/no-codex" \
    "$app/Contents/MacOS/Roomkit" --no-browser >"$stage/startup.log" 2>&1 &
  server_pid=$!
  for attempt in {1..80}; do
    if grep -q '^ROOMKIT_READY ' "$stage/startup.log"; then return; fi
    if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
    sleep 0.5
  done
  cat "$stage/startup.log" >&2
  exit 1
}
function stop_roomkit() {
  kill "$server_pid" 2>/dev/null || true
  for attempt in {1..100}; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      wait "$server_pid"
      server_pid=
      return
    fi
    sleep 0.1
  done
  kill -KILL "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=
  printf '%s\n' 'Roomkit did not quit in time.' >&2
  return 1
}
launch_roomkit
project_id="$("$node" "$(dirname "$0")/check-packaged-server.mjs" "$resources" fresh)"
stop_roomkit
launch_roomkit
reopened_id="$("$node" "$(dirname "$0")/check-packaged-server.mjs" "$resources" reopened)"
if [[ "$project_id" != "$reopened_id" ]]; then
  printf '%s\n' 'The sample room was lost after restarting Roomkit.' >&2
  exit 1
fi
printf '%s\n' 'Roomkit DMG smoke test passed.'
