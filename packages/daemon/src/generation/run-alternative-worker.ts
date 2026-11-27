import { copyFileSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PythonWorkerError } from "../python/python-worker-error.ts";
import { runPythonWorker } from "../python/run-python-worker.ts";
import type { GenerationRecord } from "./generation-record-schema.ts";
import { jobFilePath } from "./job-file-path.ts";

const InputSchema = z.object({
  name: z.string(),
  photos: z.array(z.string()).min(1),
  masks: z.array(z.string()),
});
const LimitSchema = z.coerce.number().int().positive();
const methodLabels = { trellis2: "TRELLIS.2", sam3d: "SAM 3D" };
const ResultSchema = z.object({
  glbPath: z.string(),
  sourceUp: z.literal("+Z"),
  sourceFront: z.literal("-Y"),
  model: z.enum(["trellis2", "sam3d"]),
});

export async function runAlternativeWorker(options: {
  record: GenerationRecord;
  folder: string;
  python: string;
  repo: string;
  weightsRoot: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  processPath: string;
  onProgress: Parameters<typeof runPythonWorker>[0]["onProgress"];
  onLine: (line: string) => void;
  onRetry: () => void;
}) {
  if (options.record.job.kind !== "generation-alternative")
    throw new Error("Expected an alternative job");
  const input = InputSchema.parse(
    JSON.parse(readFileSync(join(options.folder, "job.json"), "utf8")),
  );
  const photo = input.photos.at(0);
  if (!photo) throw new Error("Alternative has no reference photo");
  const photoPath = jobFilePath({ folder: options.folder, path: photo });
  const mask = input.masks.at(0);
  if (!mask && !input.name.trim())
    throw new Error("Name the item so it can be found in the reference photo");
  const method = options.record.job.method;
  const label = methodLabels[method];
  const outputDir = join(options.folder, "worker");
  const timeoutMs = LimitSchema.parse(
    options.env.PLANNER_PYTHON_TIMEOUT_MS ?? 1_800_000,
  );
  const inactivityMs = LimitSchema.parse(
    options.env.PLANNER_PYTHON_INACTIVITY_MS ?? 420_000,
  );
  async function run(attempt: number): Promise<unknown> {
    try {
      return await runPythonWorker({
        ...options,
        workersDir: join(options.repo, "python", "workers"),
        worker: method === "trellis2" ? "generate_trellis" : "generate_sam3d",
        machineLock: {
          path: join(options.repo, "scripts", "machine-lock.sh"),
          label: `alternative-${method}`,
        },
        onProgress(progress) {
          if (progress.stage !== "running") options.onProgress(progress);
        },
        input: {
          name: input.name,
          photoPath,
          ...(mask
            ? { maskPath: jobFilePath({ folder: options.folder, path: mask }) }
            : {}),
          weightsDir: options.weightsRoot,
          outputDir,
          ...(method === "trellis2"
            ? {
                pipelineType: "512",
                targetFaces: attempt === 0 ? 150_000 : 50_000,
              }
            : {}),
        },
        timeoutMs,
        inactivityMs,
      });
    } catch (error) {
      options.signal.throwIfAborted();
      if (!(error instanceof PythonWorkerError)) throw error;
      switch (error.kind) {
        case "output":
        case "exit":
          throw new Error(
            error.isUserFacing
              ? error.message
              : `Alternative ${label} failed; see the job log`,
          );
        case "timeout":
          throw new Error(
            `${label} took longer than ${formatDuration(timeoutMs)}`,
          );
        case "stalled":
          if (method !== "trellis2")
            throw new Error(
              `${label} stalled: no progress for ${formatDuration(inactivityMs)}`,
            );
          break;
        default: {
          const unreachable: never = error.kind;
          throw new Error(String(unreachable));
        }
      }
      if (attempt === 1) throw new Error("TRELLIS.2 stalled");
      options.record.attempt = 1;
      options.onRetry();
      options.onLine("TRELLIS.2 stalled; retrying at 50,000 faces");
      return run(1);
    }
  }
  const result = ResultSchema.parse(await run(options.record.attempt));
  if (result.model !== options.record.job.method)
    throw new Error("Worker returned a different generation method");
  options.signal.throwIfAborted();
  copyFileSync(
    jobFilePath({ folder: outputDir, path: realpathSync(result.glbPath) }),
    join(options.folder, "raw.glb"),
  );
  return result;
}

function formatDuration(durationMs: number) {
  return durationMs < 60_000
    ? `${Math.round(durationMs / 1000)} s`
    : `${Math.round(durationMs / 60_000)} min`;
}
