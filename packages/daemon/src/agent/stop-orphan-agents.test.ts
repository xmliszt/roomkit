import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { writeJson } from "../util/write-json.ts";
import { stopOrphanAgents } from "./stop-orphan-agents.ts";

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildRecord(options: {
  id: string;
  pid: number;
  processIdentity: { bootId: string; startedAt: string } | undefined;
}) {
  return {
    id: options.id,
    role: "designer",
    cli: "claude",
    model: "fake",
    turns: 0,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    sessionCostUsd: 0,
    tokens: 0,
    status: "running",
    createdAt: "2026-11-22T10:00:00.000Z",
    lastTurnAt: "2026-11-22T10:00:00.000Z",
    note: "",
    pid: options.pid,
    processIdentity: options.processIdentity,
  };
}

test("stops an orphan whose process identity matches and leaves a reused pid alone", async () => {
  const fixture = await createTestFixture();
  const orphan = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const stranger = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  try {
    const project = fixture.daemon.store.createProject({
      name: "Orphans",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const sessions = join(
      fixture.daemon.store.projectPath(project.id),
      ".planner",
      "sessions",
    );
    mkdirSync(sessions, { recursive: true });
    const orphanPid = orphan.pid ?? 0;
    const strangerPid = stranger.pid ?? 0;
    const strangerIdentity = readProcessIdentity(strangerPid);
    writeJson({
      path: join(sessions, "designer-1.json"),
      value: buildRecord({
        id: "designer-1",
        pid: orphanPid,
        processIdentity: readProcessIdentity(orphanPid),
      }),
    });
    writeJson({
      path: join(sessions, "designer-2.json"),
      value: buildRecord({
        id: "designer-2",
        pid: strangerPid,
        processIdentity:
          strangerIdentity === undefined
            ? undefined
            : { ...strangerIdentity, startedAt: "Thu Jan  1 00:00:00 1970" },
      }),
    });

    await stopOrphanAgents({ store: fixture.daemon.store });

    expect(isAlive(orphanPid), "the orphan is stopped").toBe(false);
    expect(
      isAlive(strangerPid),
      "a process with another identity survives",
    ).toBe(true);
    for (const id of ["designer-1", "designer-2"]) {
      const record = JSON.parse(
        readFileSync(join(sessions, `${id}.json`), "utf8"),
      );
      expect(record).toMatchObject({
        status: "interrupted",
        note: "Daemon restarted during the turn",
      });
      expect(record.pid).toBeUndefined();
      expect(record.processIdentity).toBeUndefined();
    }
  } finally {
    for (const child of [orphan, stranger])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    await fixture.close();
  }
});
