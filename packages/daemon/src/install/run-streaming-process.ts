import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { createTokenScrubber } from "../util/create-token-scrubber.ts";

/** Run a command in its own process group, pass each output line to `onLine` without ANSI codes or secrets, and resolve with its exit code. */
export function runStreamingProcess(options: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  signal: AbortSignal;
  onLine: (line: string) => void;
}): Promise<{ code: number }> {
  const redact = createTokenScrubber(options.env);
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnExitCode: number | undefined;
    function createSplitter() {
      let pending = "";
      return {
        push(chunk: string) {
          const parts = `${pending}${chunk}`.split(/\r\n|\r|\n/);
          pending = parts.pop() ?? "";
          for (const part of parts) emit(part);
        },
        flush() {
          emit(pending);
          pending = "";
        },
      };
    }
    function emit(raw: string) {
      const line = redact(stripVTControlCharacters(raw)).trimEnd();
      if (line.trim() !== "") options.onLine(line);
    }
    const stdout = createSplitter();
    const stderr = createSplitter();
    child.stdout.setEncoding("utf8").on("data", stdout.push);
    child.stderr.setEncoding("utf8").on("data", stderr.push);
    function abort() {
      if (child.pid !== undefined)
        stopProcessGroup(child.pid).catch((error: unknown) =>
          emit(String(error)),
        );
    }
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    child.on("error", (error) => {
      emit(error.message);
      if ("code" in error && error.code === "ENOENT") spawnExitCode = 127;
    });
    child.on("close", (code) => {
      options.signal.removeEventListener("abort", abort);
      stdout.flush();
      stderr.flush();
      resolve({ code: spawnExitCode ?? code ?? 1 });
    });
  });
}
