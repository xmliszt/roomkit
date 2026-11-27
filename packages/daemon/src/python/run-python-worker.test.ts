import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runPythonWorker } from "./run-python-worker.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "planner-python-test-"));
  roots.push(root);
  const control = join(root, "control.json");
  writeFileSync(control, JSON.stringify({ mode }));
  return {
    python: resolve("scripts/b6/fake-python.mjs"),
    workersDir: resolve("python/workers"),
    worker: "intake",
    input: {},
    env: {
      PATH: process.env.PATH,
      PLANNER_HOME: root,
      PLANNER_PROJECTS: root,
      B6_CONTROL: control,
      B6_CALLS: join(root, "calls"),
    },
    signal: new AbortController().signal,
    timeoutMs: 2000,
    processPath: join(root, "process.json"),
    onLine: () => undefined,
    onProgress: () => undefined,
  } satisfies Parameters<typeof runPythonWorker>[0];
}
test("malformed stdout kills the worker and removes its process record", async () => {
  const options = fixture("malformed");
  await expect(runPythonWorker(options)).rejects.toThrow();
  expect(existsSync(options.processPath)).toBe(false);
});
test("a successful exit without a result is rejected", async () => {
  await expect(runPythonWorker(fixture("no-result"))).rejects.toThrow(
    "no result",
  );
});
test("a timeout terminates a worker waiting for input progress", async () => {
  const options = { ...fixture("pause-intake"), timeoutMs: 150 };
  await expect(runPythonWorker(options)).rejects.toThrow("timed out");
  expect(existsSync(options.processPath)).toBe(false);
});
test("an already aborted worker never starts", async () => {
  const options = { ...fixture("pause-intake"), signal: AbortSignal.abort() };
  expect(() => runPythonWorker(options)).toThrow();
  expect(existsSync(options.processPath)).toBe(false);
});

test("interrupting a worker releases its machine lock and removes its process record", async () => {
  const controller = new AbortController();
  const options = fixture("pause-intake");
  const lock = join(options.env.PLANNER_HOME, "machine.lock");
  await expect(
    runPythonWorker({
      ...options,
      signal: controller.signal,
      machineLock: { path: resolve("scripts/machine-lock.sh"), label: "test" },
      env: { ...options.env, PLANNER_MACHINE_LOCK: lock },
      onProgress(progress) {
        if (progress.stage === "intake") controller.abort();
      },
    }),
  ).rejects.toThrow("interrupted");
  expect(existsSync(lock)).toBe(false);
  expect(existsSync(options.processPath)).toBe(false);
});

test("interrupting at lock acquisition releases the lock without starting another worker", async () => {
  const controller = new AbortController();
  const options = fixture("pause-intake");
  const lock = join(options.env.PLANNER_HOME, "machine.lock");
  await expect(
    runPythonWorker({
      ...options,
      signal: controller.signal,
      machineLock: { path: resolve("scripts/machine-lock.sh"), label: "test" },
      env: { ...options.env, PLANNER_MACHINE_LOCK: lock },
      onProgress(progress) {
        if (progress.stage === "generating") controller.abort();
      },
    }),
  ).rejects.toThrow("interrupted");
  expect(existsSync(lock)).toBe(false);
  expect(existsSync(options.processPath)).toBe(false);
});

test("waiting for another lock holder has no run timeout and can be interrupted", async () => {
  const options = fixture("pause-intake");
  const lock = join(options.env.PLANNER_HOME, "machine.lock");
  mkdirSync(lock);
  const holder = `${process.pid} other-worker`;
  writeFileSync(join(lock, "holder"), holder);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    await expect(
      runPythonWorker({
        ...options,
        signal: controller.signal,
        timeoutMs: 25,
        machineLock: {
          path: resolve("scripts/machine-lock.sh"),
          label: "test",
        },
        env: { ...options.env, PLANNER_MACHINE_LOCK: lock },
      }),
    ).rejects.toThrow("interrupted");
    expect(readFileSync(join(lock, "holder"), "utf8")).toBe(holder);
    expect(existsSync(options.processPath)).toBe(false);
  } finally {
    clearTimeout(timer);
  }
});

test("a progress callback failure stops the wrapper and removes its process record", async () => {
  const options = fixture("pause-intake");
  const lock = join(options.env.PLANNER_HOME, "machine.lock");
  await expect(
    runPythonWorker({
      ...options,
      machineLock: { path: resolve("scripts/machine-lock.sh"), label: "test" },
      env: { ...options.env, PLANNER_MACHINE_LOCK: lock },
      onProgress() {
        throw new Error("Progress persistence failed");
      },
    }),
  ).rejects.toThrow("Progress persistence failed");
  expect(existsSync(options.processPath)).toBe(false);
});

test("a final stderr log failure still removes the process record", async () => {
  const options = fixture("no-result");
  const python = join(options.env.PLANNER_HOME, "stderr-python");
  writeFileSync(
    python,
    `#!${process.execPath}\nprocess.stderr.write("final stderr");\nprocess.stdout.write(JSON.stringify({kind:"result",result:{ok:true}})+"\\n");\n`,
    { mode: 0o755 },
  );
  await expect(
    runPythonWorker({
      ...options,
      python,
      onLine(line) {
        if (line === "final stderr") throw new Error("Log write failed");
      },
    }),
  ).rejects.toThrow("Log write failed");
  expect(existsSync(options.processPath)).toBe(false);
});
