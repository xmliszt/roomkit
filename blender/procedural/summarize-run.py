"""Print a cold run's turns, time, API-equivalent cost, Blender runs, previews, denials and final message.

python3 summarize-run.py <job folder>
"""

import json
import pathlib
import sys

job = pathlib.Path(sys.argv[1])
previews = blender_runs = denied = 0
results = []
for line in (job / ".log.jsonl").read_text(errors="replace").splitlines():
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    if event.get("type") == "assistant":
        for part in event["message"].get("content", []):
            if part.get("type") == "tool_use" and part["name"] == "Bash":
                command = part["input"].get("command", "")
                previews += "preview.sh" in command
                blender_runs += "blender-run.sh" in command
    if event.get("type") == "user" and isinstance(event["message"].get("content"), list):
        for part in event["message"]["content"]:
            if part.get("type") == "tool_result" and "permission" in str(part.get("content", "")).lower():
                denied += 1
    if event.get("type") == "result":
        results.append(event)
final = results[-1] if results else {}
print(
    json.dumps(
        {
            "turns": sum(r.get("num_turns", 0) for r in results),
            "agentSeconds": round(sum(r.get("duration_ms", 0) for r in results) / 1000),
            "costUsd": round(final.get("total_cost_usd", 0), 2),
            "blenderRuns": blender_runs,
            "previews": previews,
            "denied": denied,
            "glb": (job / "raw.glb").exists(),
        }
    )
)
print(final.get("result", "(no result)")[:1800])
