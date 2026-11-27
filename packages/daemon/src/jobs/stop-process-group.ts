import { setTimeout } from "node:timers/promises";
import { readProcessGroup } from "./read-process-group.ts";
import { signalProcessGroup } from "./signal-process-group.ts";

export async function stopProcessGroup(pid: number) {
  signalProcessGroup({ pid, signal: "SIGTERM" });
  const deadline = Date.now() + 5000;
  const killDeadline = deadline + 5000;
  while ((await readProcessGroup(pid)).length) {
    if (Date.now() >= killDeadline)
      throw new Error(
        `Process group ${pid} survived SIGKILL; keeping project locked`,
      );
    signalProcessGroup({
      pid,
      signal: Date.now() >= deadline ? "SIGKILL" : "SIGTERM",
    });
    await setTimeout(50);
  }
}
