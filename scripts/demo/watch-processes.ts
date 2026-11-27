import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export function watchProcesses(options: { path: string; rootPid: number }) {
  const seen = new Set<string>();
  const violations: string[] = [];
  function sample() {
    try {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .flatMap((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
          return match
            ? [
                {
                  pid: Number(match.at(1)),
                  parentPid: Number(match.at(2)),
                  command: match.at(3) ?? "",
                },
              ]
            : [];
        });
      const descendants = new Set([options.rootPid]);
      for (let count = -1; count !== descendants.size; ) {
        count = descendants.size;
        for (const row of rows)
          if (descendants.has(row.parentPid)) descendants.add(row.pid);
      }
      for (const row of rows) {
        if (row.pid === options.rootPid || !descendants.has(row.pid)) continue;
        if (row.command === "ps -axo pid=,ppid=,command=") continue;
        const key = `${row.pid}:${row.command}`;
        if (seen.has(key)) continue;
        seen.add(key);
        appendFileSync(
          options.path,
          `${JSON.stringify({ ...row, at: Date.now() })}\n`,
        );
        if (
          /(?:^|\/)(?:claude|codex|blender|python(?:\d+(?:\.\d+)*)?)(?:\s|$)/i.test(
            row.command,
          )
        )
          violations.push(row.command);
      }
    } catch (error) {
      if (error instanceof Error && "signal" in error && error.signal) return;
      violations.push(`Process inspection failed: ${String(error)}`);
    }
  }
  sample();
  const timer = setInterval(sample, 100);
  return {
    violations,
    stop() {
      clearInterval(timer);
      sample();
      return { processes: seen.size, violations };
    },
  };
}
