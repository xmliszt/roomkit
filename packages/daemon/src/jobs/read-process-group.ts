import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function readProcessGroup(pid: number) {
  const { stdout } = await promisify(execFile)(
    "ps",
    ["-axo", "pid=,ppid=,pgid=,stat=,lstart=,command="],
    { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/.exec(
      line,
    );
    if (Number(match?.at(3)) !== pid || match?.at(4)?.startsWith("Z"))
      return [];
    return [
      {
        pid: Number(match?.at(1)),
        parentPid: Number(match?.at(2)),
        startedAt: Date.parse(match?.at(5) ?? ""),
        command: match?.at(6) ?? "",
      },
    ];
  });
}
