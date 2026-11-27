import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createDaemon } from "./create-daemon.ts";
import { readProcessGroup } from "./jobs/read-process-group.ts";
import { readProcessIdentity } from "./jobs/read-process-identity.ts";
import { stopProcessGroup } from "./jobs/stop-process-group.ts";
import { writeJson } from "./util/write-json.ts";

async function buildOrphanFixture(options: { verified: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "planner-daemon-orphan-"));
  const env = {
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    PLANNER_HOME: join(root, "planner"),
    PLANNER_PROJECTS: join(root, "projects"),
    PLANNER_PORT: "0",
    PLANNER_WEB_PORT: "0",
    PLANNER_WEB_ORIGIN: "http://localhost:0",
    PLANNER_CLAUDE_BIN: join(root, "no-claude"),
    PLANNER_CODEX_BIN: join(root, "no-codex"),
    PLANNER_PYTHON_BIN: join(root, "no-python"),
  };
  const worker = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000);"],
    { detached: true, stdio: ["ignore", "pipe", "ignore"], env },
  );
  const daemon = createDaemon({ env });
  const exited = once(worker, "exit");
  try {
    await once(worker.stdout, "data");
    if (!worker.pid) throw new Error("Fake worker has no PID");
    const identity = readProcessIdentity(worker.pid);
    if (!identity) throw new Error("Fake worker identity is unavailable");
    const record = {
      pid: worker.pid,
      identity: options.verified
        ? identity
        : { ...identity, startedAt: "a different process" },
    };
    const recordPath = join(env.PLANNER_HOME, "python-worker.json");
    writeJson({ path: recordPath, value: record });
    return {
      daemon,
      worker,
      exited,
      record,
      recordPath,
      daemonFilePath: join(env.PLANNER_HOME, "daemon.json"),
      async close() {
        await daemon.close();
        if (worker.pid) await stopProcessGroup(worker.pid);
        await exited;
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await daemon.close();
    if (worker.pid) await stopProcessGroup(worker.pid);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("startup stops a verified orphan Python worker with no remaining projects or jobs", async () => {
  const fixture = await buildOrphanFixture({ verified: true });
  try {
    expect(fixture.daemon.store.listProjects()).toEqual([]);
    await fixture.daemon.listen();
    expect(existsSync(fixture.recordPath)).toBe(false);
    await fixture.exited;
    expect(await readProcessGroup(fixture.record.pid)).toEqual([]);
    expect(existsSync(fixture.daemonFilePath)).toBe(true);
  } finally {
    await fixture.close();
  }
});

test("startup refuses an unverified worker group and retains the process record", async () => {
  const fixture = await buildOrphanFixture({ verified: false });
  try {
    await expect(fixture.daemon.listen()).rejects.toThrow(
      "identity cannot be verified",
    );
    expect(JSON.parse(readFileSync(fixture.recordPath, "utf8"))).toEqual(
      fixture.record,
    );
    expect(fixture.worker.exitCode).toBeNull();
    expect(fixture.worker.signalCode).toBeNull();
    expect((await readProcessGroup(fixture.record.pid)).length).toBeGreaterThan(
      0,
    );
    expect(existsSync(fixture.daemonFilePath)).toBe(false);
  } finally {
    await fixture.close();
  }
});
