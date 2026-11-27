import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { readProcessGroup } from "../jobs/read-process-group.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";

test("Ctrl-C to the lock holder group kills its command and grandchild before releasing the lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "planner-lock-sigint-"));
  const lock = join(root, "machine.lock");
  const ready = join(root, "grandchild.pid");
  const parent = join(root, "parent.mjs");
  const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  writeFileSync(
    parent,
    `import {spawn} from 'node:child_process';spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000);`,
  );
  const child = spawn(
    resolve("scripts/machine-lock.sh"),
    ["ctrl-c-test", process.execPath, parent],
    {
      env: {
        PATH: process.env.PATH,
        PLANNER_HOME: root,
        PLANNER_PROJECTS: root,
        PLANNER_MACHINE_LOCK: lock,
      },
      detached: true,
      stdio: "ignore",
    },
  );
  const exited = once(child, "exit");
  try {
    await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
    const pid = child.pid;
    if (pid === undefined) throw new Error("Missing lock holder PID");
    const grandchildPid = Number(readFileSync(ready, "utf8"));
    expect(readProcessIdentity(grandchildPid)).toBeDefined();
    expect(existsSync(lock)).toBe(true);
    process.kill(-pid, "SIGINT");
    expect((await exited).at(0)).toBe(130);
    expect(readProcessIdentity(grandchildPid)).toBeUndefined();
    expect(await readProcessGroup(pid)).toEqual([]);
    expect(existsSync(lock)).toBe(false);
  } finally {
    if (child.pid !== undefined) await stopProcessGroup(child.pid);
    rmSync(root, { recursive: true, force: true });
  }
});
