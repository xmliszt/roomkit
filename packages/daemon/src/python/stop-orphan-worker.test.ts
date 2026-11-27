import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readProcessGroup } from "../jobs/read-process-group.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { stopOrphanWorker } from "./stop-orphan-worker.ts";

test("an orphan child with no verifiable leader blocks recovery and retains its record", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-orphan-worker-"));
  const leader = spawn(
    process.execPath,
    [
      "-e",
      `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.stdout.write(String(child.pid)); setInterval(()=>{},1000);`,
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH,
        PLANNER_HOME: root,
        PLANNER_PROJECTS: root,
      },
    },
  );
  try {
    await once(leader.stdout, "data");
    if (!leader.pid) throw new Error("No leader pid");
    const identity = readProcessIdentity(leader.pid);
    expect(identity).toBeDefined();
    const path = join(root, "worker.json");
    writeFileSync(path, JSON.stringify({ pid: leader.pid, identity }));
    const exited = once(leader, "exit");
    leader.kill("SIGKILL");
    await exited;
    expect((await readProcessGroup(leader.pid)).length).toBeGreaterThan(0);
    await expect(stopOrphanWorker(path)).rejects.toThrow(
      "identity cannot be verified",
    );
    expect(existsSync(path)).toBe(true);
    await stopProcessGroup(leader.pid);
    await stopOrphanWorker(path);
    expect(existsSync(path)).toBe(false);
  } finally {
    if (leader.pid) await stopProcessGroup(leader.pid);
    rmSync(root, { recursive: true, force: true });
  }
});
