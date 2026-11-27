import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { writeJson } from "../util/write-json.ts";
import { PythonWorkerError } from "./python-worker-error.ts";

const FrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    stage: z.string(),
    progress: z.number().finite().min(0).max(1).optional(),
  }),
  z.object({ kind: z.literal("result"), result: z.unknown() }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    isUserFacing: z.boolean().optional(),
  }),
]);

export function runPythonWorker(options: {
  python: string;
  workersDir: string;
  worker:
    | "intake"
    | "segment"
    | "reconstruct"
    | "coverage"
    | "measure"
    | "generate_trellis"
    | "generate_sam3d";
  machineLock?: { path: string; label: string };
  input: unknown;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  /** Stop the worker when this long passes without a progress frame other than the `running` heartbeat. */
  inactivityMs?: number;
  processPath: string;
  onLine: (line: string) => void;
  onProgress: (progress: {
    stage: string;
    progress?: number | undefined;
    waitingFor?: "machine" | undefined;
  }) => void;
}): Promise<unknown> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.machineLock?.path ?? options.python,
      [
        ...(options.machineLock
          ? [options.machineLock.label, options.python]
          : []),
        join(options.workersDir, `${options.worker}.py`),
      ],
      {
        env: options.env,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let pending = "";
    let pendingStderr = "";
    let stderr = "";
    let result: unknown;
    let hasResult = false;
    let failure: Error | undefined;
    let stopping: Promise<void> | undefined;
    function stop(error: Error) {
      failure ??= error;
      if (child.pid !== undefined && stopping === undefined)
        stopping = stopProcessGroup(child.pid);
      stopping?.catch(() => undefined);
    }
    function abort() {
      stop(new Error("Python worker interrupted"));
    }
    function reportProgress(
      progress: Parameters<typeof options.onProgress>[0],
    ) {
      try {
        options.onProgress(progress);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    function restartInactivityTimer() {
      const inactivityMs = options.inactivityMs;
      if (inactivityMs === undefined || timer === undefined || failure) return;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        () =>
          stop(
            new PythonWorkerError({
              kind: "stalled",
              message: `Python worker made no progress for ${inactivityMs} ms`,
            }),
          ),
        inactivityMs,
      );
    }
    function startTimer() {
      if (timer !== undefined || failure) return;
      timer = setTimeout(
        () =>
          stop(
            new PythonWorkerError({
              kind: "timeout",
              message: `Python worker timed out after ${options.timeoutMs} ms`,
            }),
          ),
        options.timeoutMs,
      );
      restartInactivityTimer();
    }
    if (options.machineLock)
      reportProgress({ stage: "waiting", waitingFor: "machine" });
    else startTimer();
    options.signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.stdin.on("error", (error) => stop(error));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
      pendingStderr += chunk;
      const lines = pendingStderr.split("\n");
      pendingStderr = (lines.pop() ?? "").slice(-8000);
      try {
        for (const line of lines) options.onLine(line);
        if (
          options.machineLock &&
          timer === undefined &&
          !failure &&
          lines.includes("machine-lock: acquired")
        ) {
          startTimer();
          reportProgress({ stage: "generating", waitingFor: undefined });
        }
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
    function line(raw: string) {
      if (!raw.trim()) return;
      try {
        options.onLine(raw);
        if (failure) return;
        const frame = FrameSchema.parse(JSON.parse(raw));
        if (hasResult)
          throw new Error("Worker emitted output after its result");
        switch (frame.kind) {
          case "progress":
            if (frame.stage !== "running") restartInactivityTimer();
            reportProgress(frame);
            break;
          case "result":
            result = frame.result;
            hasResult = true;
            break;
          case "error":
            stop(
              new PythonWorkerError({
                kind: "output",
                message: frame.message,
                isUserFacing: frame.isUserFacing,
              }),
            );
            break;
        }
      } catch (error) {
        stop(
          new PythonWorkerError({
            kind: "output",
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          }),
        );
      }
    }
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      pending += chunk;
      if (pending.length > 16 * 1024 * 1024) {
        stop(new Error("Worker stdout exceeded 16 MB"));
        return;
      }
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const raw of lines) line(raw);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      clearTimeout(inactivityTimer);
      options.signal.removeEventListener("abort", abort);
      line(pending);
      try {
        if (child.pid !== undefined)
          await (stopping ?? stopProcessGroup(child.pid));
        rmSync(options.processPath, { force: true });
        if (pendingStderr) options.onLine(pendingStderr);
        if (failure) throw failure;
        if (code !== 0 || !hasResult)
          throw new PythonWorkerError({
            kind: "exit",
            message: `Python ${options.worker} failed (${code}): ${stderr || "no result"}`,
          });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    try {
      if (child.pid !== undefined) {
        const identity = readProcessIdentity(child.pid);
        if (!identity) throw new Error("Could not identify Python worker");
        writeJson({
          path: options.processPath,
          value: { pid: child.pid, identity },
        });
        child.stdin.end(JSON.stringify(options.input));
      }
      if (options.signal.aborted) abort();
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
