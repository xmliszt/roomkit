import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export const ignoreSigterm = true;

export function steps() {
  const child = spawn("sleep", ["600"], { stdio: "ignore" });
  if (process.env.FAKE_CLI_PID_PATH)
    writeFileSync(
      process.env.FAKE_CLI_PID_PATH,
      JSON.stringify({ cliPid: process.pid, childPid: child.pid }),
    );
  return [
    { kind: "tool", name: "scene_get" },
    { kind: "text", text: "Holding" },
    { kind: "sleep", durationMs: 600000 },
  ];
}
