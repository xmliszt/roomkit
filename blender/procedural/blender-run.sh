#!/usr/bin/env bash
# Run a modeler script in headless Blender: blender-run.sh <script.py> <job.json>
# Prints the run time, then the script's output. Keeps a copy of the script and any new raw.glb in <job>/.rounds/. Stops the run after BLENDER_TIMEOUT_S seconds.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
TIMEOUT_S="${BLENDER_TIMEOUT_S:-900}"
if [ $# -ne 2 ]; then
  echo "usage: blender-run.sh <script.py> <job.json>" >&2
  exit 2
fi
script="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
job="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
folder="$(dirname "$job")"
mkdir -p "$folder/.rounds"
touch "$folder/.rounds/.start"
set +e
perl -e '
  my ($timeout, @command) = @ARGV;
  my $start = time;
  my $pid = fork;
  if ($pid == 0) { exec @command or die "exec failed: $!" }
  local $SIG{ALRM} = sub { kill "TERM", $pid; print "blender-run: stopped after $timeout s\n"; exit 124 };
  alarm $timeout;
  waitpid $pid, 0;
  my $status = $? >> 8;
  printf "run time %d s, exit %d\n", time - $start, $status;
  exit $status;
' "$TIMEOUT_S" "$BLENDER" --background --factory-startup --python-exit-code 1 --python "$script" -- --job "$job" 2>&1 \
  | grep -vE '^(Fra:|Info: Baking map| *$)|Draco is available|MeshOptimizer is available'
status="${PIPESTATUS[0]}"
set -e
stamp="$(date +%H%M%S)"
cp "$script" "$folder/.rounds/$stamp-$(basename "$script")"
if [ -f "$folder/raw.glb" ] && [ "$folder/raw.glb" -nt "$folder/.rounds/.start" ]; then
  cp "$folder/raw.glb" "$folder/.rounds/$stamp-raw.glb"
fi
exit "$status"
