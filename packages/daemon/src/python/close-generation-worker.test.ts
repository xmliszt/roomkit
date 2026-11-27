import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { createReconFixture } from "../../../../scripts/b6/create-recon-fixture.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { runPythonWorker } from "./run-python-worker.ts";
import { stopOrphanWorker } from "./stop-orphan-worker.ts";

test("fixture cleanup stops detached generation workers and releases their machine lock", async () => {
  const fixture = await createReconFixture({ keep: true });
  const processPath = join(fixture.root, "home", "generation-worker.json");
  const lockPath = join(fixture.root, "machine.lock");
  try {
    await fixture.start();
    fixture.control({ mode: "pause-intake" });
    const started = Promise.withResolvers<void>();
    const running = runPythonWorker({
      python: resolve("scripts/b6/fake-python.mjs"),
      workersDir: resolve("python/workers"),
      worker: "intake",
      machineLock: {
        path: resolve("scripts/machine-lock.sh"),
        label: "cleanup-test",
      },
      input: {},
      env: { ...fixture.env, PLANNER_MACHINE_LOCK: lockPath },
      signal: new AbortController().signal,
      timeoutMs: 5000,
      processPath,
      onLine() {},
      onProgress(progress) {
        if (progress.stage === "intake") started.resolve();
      },
    }).catch((error: unknown) => error);
    await started.promise;
    const { pid } = z
      .object({ pid: z.number() })
      .parse(JSON.parse(readFileSync(processPath, "utf8")));
    expect(readProcessIdentity(pid)).toBeDefined();
    expect(existsSync(lockPath)).toBe(true);
    await fixture.close();
    expect(await running).toBeInstanceOf(Error);
    expect(readProcessIdentity(pid)).toBeUndefined();
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(processPath)).toBe(false);
  } finally {
    await fixture.close();
    await stopOrphanWorker(processPath);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
