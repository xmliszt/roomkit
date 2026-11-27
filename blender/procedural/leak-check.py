"""List every absolute path a cold job's scripts or tool calls used outside its own folder and the two commands,
and every script line that could reach outside the folder another way (home folder, parent folder, environment,
directory listing). A best-effort text search: it reports candidates for a person to read and enforces nothing.

python3 leak-check.py <job folder>
"""

import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ESCAPE = re.compile(r"expanduser|environ|getenv|HOME|listdir|scandir|glob|walk\(|\.\./|['\"]~|['\"]\.\.['\"]|\.parent\b|home\(\)|pardir|dirname\(")
PATH = re.compile(r"(?<![\w.])(/(?:Users|private|tmp|var|opt|Applications|Volumes)[^\s'\"),;]*)")


def main():
    job = pathlib.Path(sys.argv[1]).resolve()
    allowed = (str(job), str(HERE / "blender-run.sh"), str(HERE / "preview.sh"))
    found = set()
    escapes = []
    for script in [*job.glob("*.py"), *(job / ".rounds").glob("*.py")]:
        text = script.read_text(errors="replace")
        found.update(PATH.findall(text))
        escapes += [f"{script.name}: {line.strip()}" for line in text.splitlines() if ESCAPE.search(line)]
    for line in (job / ".log.jsonl").read_text(errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "assistant":
            continue
        for part in event["message"].get("content", []):
            if part.get("type") == "tool_use":
                found.update(PATH.findall(json.dumps(part.get("input", {}))))
    outside = sorted(path for path in found if not path.startswith(allowed) and path != str(HERE))
    print("\n".join(outside) if outside else "no paths outside the job folder")
    print("\n".join(escapes) if escapes else "no script lines that reach outside the folder another way")


main()
