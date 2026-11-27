import { spawn } from "node:child_process";
import { signalProcessGroup } from "../jobs/signal-process-group.ts";
import { scrubbedEnv } from "./scrubbed-env.ts";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function exec(options: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  detached?: boolean;
  signal?: AbortSignal | undefined;
}): Promise<ExecResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      detached: options.detached,
      env: options.env ?? scrubbedEnv(),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnExitCode: number | undefined;
    function abort() {
      if (options.detached && child.pid)
        signalProcessGroup({ pid: child.pid, signal: "SIGKILL" });
      else child.kill("SIGKILL");
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, options.timeoutMs ?? 5000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
    child.on("error", (error) => {
      stderr += error.message;
      if ("code" in error && error.code === "ENOENT") spawnExitCode = 127;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (options.detached && child.pid)
        signalProcessGroup({ pid: child.pid, signal: "SIGKILL" });
      resolve({ code: spawnExitCode ?? code ?? 127, stdout, stderr, timedOut });
    });
  });
}
