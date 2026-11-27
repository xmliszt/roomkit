import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scrubbedEnv } from "../util/scrubbed-env.ts";

export function readProcessIdentity(pid: number) {
  const bootId =
    process.platform === "darwin"
      ? execFileSync("sysctl", ["-n", "kern.boottime"], {
          encoding: "utf8",
          env: scrubbedEnv(),
        }).trim()
      : readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  try {
    const startedAt = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      env: { ...scrubbedEnv(), LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return startedAt ? { bootId, startedAt } : undefined;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 1)
      return undefined;
    throw error;
  }
}
