import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";
import { writeJson } from "../util/write-json.ts";

export function runGenerationProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  processPath: string;
  timeoutMs: number;
  onLine: (line: string) => void;
}): Promise<{ output: string; code: number | null }> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: scrubbedEnv({ env: options.env }),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let pending = "";
    let failure: Error | undefined;
    let stopping: Promise<void> | undefined;
    function stop(error: Error) {
      failure ??= error;
      if (child.pid !== undefined) stopping ??= stopProcessGroup(child.pid);
      stopping?.catch(() => undefined);
    }
    function abort() {
      stop(new Error("Generation process interrupted"));
    }
    const timer = setTimeout(
      () => stop(new Error("Generation process timed out")),
      options.timeoutMs,
    );
    options.signal.addEventListener("abort", abort, { once: true });
    function read(chunk: string) {
      output = (output + chunk).slice(-1_000_000);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = (lines.pop() ?? "").slice(-8000);
      try {
        for (const line of lines) if (line.trim()) options.onLine(line);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    }
    child.stdout.setEncoding("utf8").on("data", read);
    child.stderr.setEncoding("utf8").on("data", read);
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      try {
        if (child.pid !== undefined)
          await (stopping ?? stopProcessGroup(child.pid));
        rmSync(options.processPath, { force: true });
        if (pending.trim()) options.onLine(pending);
        if (failure) throw failure;
        resolve({ output, code });
      } catch (error) {
        reject(error);
      }
    });
    try {
      if (child.pid !== undefined) {
        const identity = readProcessIdentity(child.pid);
        if (!identity) throw new Error("Could not identify generation process");
        writeJson({
          path: options.processPath,
          value: { pid: child.pid, identity },
        });
      }
      if (options.signal.aborted) abort();
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
