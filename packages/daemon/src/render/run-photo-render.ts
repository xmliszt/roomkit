import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";
import { writeJson } from "../util/write-json.ts";

export function runPhotoRender(options: {
  blender: string;
  folder: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onLine: (line: string) => void;
  onAcquired: () => void;
  onSamples: (progress: number) => void;
}) {
  options.signal.throwIfAborted();
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const processPath = join(options.folder, "process.json");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      join(repo, "scripts/machine-lock.sh"),
      [
        "photo-render",
        options.blender,
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python-expr",
        "import sys; sys.dont_write_bytecode = True",
        "--python",
        join(repo, "blender/render_photo.py"),
        "--",
        join(options.folder, "scene.json"),
      ],
      {
        env: {
          ...scrubbedEnv({ env: options.env }),
          ...(options.env.PLANNER_MACHINE_LOCK
            ? { PLANNER_MACHINE_LOCK: options.env.PLANNER_MACHINE_LOCK }
            : {}),
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let failure: Error | undefined;
    let memoryFailure: Error | undefined;
    let stopping: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function stop(error: Error) {
      failure ??= error;
      if (child.pid !== undefined) stopping ??= stopProcessGroup(child.pid);
      stopping?.catch(() => undefined);
    }
    function abort() {
      stop(new Error("Render cancelled"));
    }
    options.signal.addEventListener("abort", abort, { once: true });
    function line(raw: string) {
      if (!raw.trim()) return;
      try {
        options.onLine(raw);
        if (raw.includes("machine-lock: acquired")) {
          options.onAcquired();
          timer = setTimeout(
            () => stop(new Error("The render took longer than 30 minutes")),
            30 * 60_000,
          );
        }
        const samples = /(?:Sample|Rendered)\s+(\d+)\s*\/\s*(\d+)/i.exec(raw);
        if (samples && Number(samples.at(2)) > 0)
          options.onSamples(
            Math.min(0.999, Number(samples.at(1)) / Number(samples.at(2))),
          );
        if (/out of memory|failed to allocate/i.test(raw))
          memoryFailure = new Error("Not enough memory to render this room");
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    }
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.setEncoding("utf8").on("data", (chunk: string) => {
        const lines = (pending + chunk).split(/[\r\n]/);
        pending = (lines.pop() ?? "").slice(-8000);
        for (const raw of lines) line(raw);
      });
      stream.on("end", () => line(pending));
    }
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      try {
        if (child.pid !== undefined)
          await (stopping ?? stopProcessGroup(child.pid));
        rmSync(processPath, { force: true });
        if (failure) throw failure;
        if (code !== 0 && memoryFailure) throw memoryFailure;
        if (code !== 0)
          throw new Error(
            "Blender could not render this room. Open the job log for details.",
          );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    try {
      if (child.pid !== undefined) {
        const identity = readProcessIdentity(child.pid);
        if (!identity) throw new Error("Could not identify the render process");
        writeJson({ path: processPath, value: { pid: child.pid, identity } });
      }
      if (options.signal.aborted) abort();
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
