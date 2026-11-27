#!/usr/bin/env bash
# Run one cold modeler agent: run-cold.sh <object> <tag> <prompt file> [kickoff message]
# The agent starts in a fresh job folder with only job.json, the object's photos and the helper library,
# can run only blender-run.sh and preview.sh, and stops after COLD_TIMEOUT_S seconds.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
S7_HOME="${S7_HOME:-$HOME/.cache/interior-planner-spikes/s7}"
TIMEOUT_S="${COLD_TIMEOUT_S:-3600}"
object="$1"
tag="$2"
prompt="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
kickoff="${4:-Build the object described in job.json. Start by reading job.json.}"
job="$S7_HOME/jobs/$object-$tag"

python3 "$HERE/make-job.py" --object "$object" --photos "$S7_HOME/photos" --job "$job" >/dev/null
cp "$prompt" "$job/.prompt-used.md"
node "$REPO/scripts/spikes/s5-usage-endpoints.ts" >"$job/.usage-before.txt" 2>&1 || true
start="$(date +%s)"
echo "$object $tag cold-start $(date +%T)" >>"$S7_HOME/rounds.log"

cd "$job"
set +e
perl -e '
  my ($timeout, @command) = @ARGV;
  my $pid = fork;
  if ($pid == 0) { exec @command or die "exec failed: $!" }
  local $SIG{ALRM} = sub { kill "TERM", $pid; print STDERR "run-cold: stopped after $timeout s\n"; exit 124 };
  alarm $timeout;
  waitpid $pid, 0;
  exit($? >> 8);
' "$TIMEOUT_S" env BASH_DEFAULT_TIMEOUT_MS=1200000 BASH_MAX_TIMEOUT_MS=1800000 claude -p "$kickoff" \
  --model opus \
  --append-system-prompt-file "$prompt" \
  --output-format stream-json --verbose \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources project \
  --permission-mode dontAsk \
  --tools Read,Write,Edit,Bash \
  --allowedTools "Read(/$job/**)" "Write(/$job/**)" "Edit(/$job/**)" \
  "Bash($HERE/blender-run.sh:*)" "Bash($HERE/preview.sh:*)" "Bash($HERE/blender-run.sh *)" "Bash($HERE/preview.sh *)" \
  >"$job/.log.jsonl" 2>"$job/.stderr.txt" </dev/null
status=$?
set -e
end="$(date +%s)"
node "$REPO/scripts/spikes/s5-usage-endpoints.ts" >"$job/.usage-after.txt" 2>&1 || true
echo "$object $tag cold-end $(date +%T) exit $status wall $((end - start)) s" >>"$S7_HOME/rounds.log"
echo "$job exit $status wall $((end - start)) s"
