import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import type { InstallJob } from "@planner/shared/src/jobs/job-schema.ts";
import {
  AGENT_SETUP_BYTES,
  BLENDER_SETUP_BYTES,
  PYTHON_SETUP_BYTES,
} from "@planner/shared/src/preflight/setup-storage.ts";
import type { InstallLogResult } from "@planner/shared/src/protocol/install-log-result-schema.ts";
import {
  PYTHON_ENV_MARKER,
  readLockHash,
} from "../preflight/read-lock-hash.ts";
import type { ModelRegistry } from "../preflight/read-model-registry.ts";
import type { ToolPaths } from "../preflight/resolve-tool-paths.ts";
import type { Logger } from "../util/logger.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { downloadModelWeights } from "./download-model-weights.ts";
import { requireFreeStorage } from "./require-free-storage.ts";
import { runStreamingProcess } from "./run-streaming-process.ts";

const MAX_LOG_LINES = 2000;
const LOG_FLUSH_MS = 100;
const PROGRESS_INTERVAL_MS = 250;

type JobState = {
  job: InstallJob;
  prerequisite: JobState | undefined;
  log: { firstLineIndex: number; lines: string[] };
  unsent: { firstLineIndex: number; lines: string[] };
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  updateTimer: ReturnType<typeof setTimeout> | undefined;
  lastUpdateAtMs: number;
};

function isActive(job: InstallJob) {
  return job.stage === "queued" || job.stage === "running";
}

function targetKey(target: InstallTarget) {
  if (target.kind === "agent") return `agent:${target.cli}`;
  return "modelId" in target ? `${target.kind}:${target.modelId}` : target.kind;
}

/** Run install jobs one at a time in the order they were started, publish their state and log lines, and call `onJobEnd` after each. */
export function createInstallQueue(options: {
  bus: EventBus;
  logger: Logger;
  env: NodeJS.ProcessEnv;
  paths: () => ToolPaths;
  registry: ModelRegistry;
  weightsBaseUrl: string;
  pythonProjectDir: string;
  onJobEnd: (target: InstallTarget) => Promise<void>;
}) {
  const states: JobState[] = [];
  const controller = new AbortController();
  let isPumping = false;

  function findModel(modelId: string) {
    const model = options.registry.models.find(
      (candidate) => candidate.id === modelId,
    );
    if (model === undefined) throw new Error(`Unknown model: ${modelId}`);
    return model;
  }

  function publishJob(state: JobState) {
    clearTimeout(state.updateTimer);
    state.updateTimer = undefined;
    state.lastUpdateAtMs = Date.now();
    options.bus.publish({ kind: "job.updated", job: state.job });
  }

  function flushLog(state: JobState) {
    clearTimeout(state.flushTimer);
    state.flushTimer = undefined;
    if (state.unsent.lines.length === 0) return;
    options.bus.publish({
      kind: "job.log",
      jobId: state.job.id,
      firstLineIndex: state.unsent.firstLineIndex,
      lines: state.unsent.lines,
    });
    state.unsent = {
      firstLineIndex: state.unsent.firstLineIndex + state.unsent.lines.length,
      lines: [],
    };
  }

  function update(input: {
    state: JobState;
    patch: Partial<InstallJob>;
    isStageChange: boolean;
  }) {
    const { state } = input;
    state.job = {
      ...state.job,
      ...input.patch,
      updatedAt: new Date().toISOString(),
    };
    if (input.isStageChange) {
      flushLog(state);
      publishJob(state);
      return;
    }
    if (state.updateTimer !== undefined) return;
    state.updateTimer = setTimeout(
      () => publishJob(state),
      Math.max(0, state.lastUpdateAtMs + PROGRESS_INTERVAL_MS - Date.now()),
    );
  }

  function addLine(input: { state: JobState; line: string }) {
    const { state } = input;
    state.log.lines.push(input.line);
    if (state.log.lines.length > MAX_LOG_LINES) {
      state.log.lines.shift();
      state.log.firstLineIndex += 1;
    }
    state.unsent.lines.push(input.line);
    state.flushTimer ??= setTimeout(() => flushLog(state), LOG_FLUSH_MS);
    update({ state, patch: { lastLogLine: input.line }, isStageChange: false });
  }

  async function runCommand(input: {
    state: JobState;
    command: string;
    args: string[];
    extraEnv?: NodeJS.ProcessEnv;
  }) {
    addLine({
      state: input.state,
      line: `$ ${[input.command, ...input.args].join(" ")}`,
    });
    const result = await runStreamingProcess({
      command: input.command,
      args: input.args,
      env: { ...scrubbedEnv({ env: options.env }), ...input.extraEnv },
      signal: controller.signal,
      onLine: (line) => addLine({ state: input.state, line }),
    });
    if (result.code !== 0)
      throw new Error(
        result.code === 127
          ? `${input.command} was not found`
          : `${input.command} exited with code ${result.code}`,
      );
  }

  async function runTarget(state: JobState) {
    const paths = options.paths();
    const target = state.job.target;
    if (state.prerequisite && state.prerequisite.job.stage !== "done")
      throw new Error(
        "An earlier setup step failed. Fix that step and retry setup.",
      );
    if (
      target.kind === "agent" ||
      target.kind === "blender" ||
      target.kind === "uv"
    ) {
      try {
        accessSync(paths.brew, constants.X_OK);
      } catch {
        throw new Error(
          "Install Homebrew on this Mac, then check again in Settings.",
        );
      }
      requireFreeStorage({
        folder: paths.brew,
        additionalBytes:
          target.kind === "blender" ? BLENDER_SETUP_BYTES : AGENT_SETUP_BYTES,
      });
    }
    switch (target.kind) {
      case "agent":
        return runCommand({
          state,
          command: paths.brew,
          args: [
            "install",
            "--cask",
            target.cli === "claude" ? "claude-code" : "codex",
          ],
        });
      case "uv":
        return runCommand({
          state,
          command: paths.brew,
          args: ["install", "uv"],
        });
      case "blender":
        return runCommand({
          state,
          command: paths.brew,
          args: ["install", "--cask", "blender"],
        });
      case "python-env": {
        try {
          accessSync(paths.uv, constants.X_OK);
        } catch {
          throw new Error("uv is not installed. Install uv first.");
        }
        requireFreeStorage({
          folder: paths.pythonEnv,
          additionalBytes: PYTHON_SETUP_BYTES,
        });
        const markerPath = join(paths.pythonEnv, PYTHON_ENV_MARKER);
        await rm(markerPath, { force: true });
        await runCommand({
          state,
          command: paths.uv,
          args: ["sync", "--project", options.pythonProjectDir, "--frozen"],
          extraEnv: { UV_PROJECT_ENVIRONMENT: paths.pythonEnv },
        });
        writeJson({
          path: markerPath,
          value: { lockSha256: readLockHash(options.pythonProjectDir) },
        });
        return;
      }
      case "weights-download":
        return downloadModelWeights({
          model: findModel(target.modelId),
          baseUrl: options.weightsBaseUrl,
          weightsRoot: paths.weights,
          signal: controller.signal,
          onLine: (line) => addLine({ state, line }),
          onProgress: (progress) =>
            update({ state, patch: { progress }, isStageChange: false }),
        });
      case "weights-delete": {
        const folder = join(paths.weights, findModel(target.modelId).folder);
        addLine({ state, line: `Deleting ${folder}` });
        await rm(folder, { recursive: true, force: true });
        return;
      }
      default: {
        const exhaustive: never = target;
        return exhaustive;
      }
    }
  }

  async function pump() {
    if (isPumping) return;
    isPumping = true;
    try {
      while (!controller.signal.aborted) {
        const state = states.find(
          (entry) =>
            entry.job.stage === "queued" &&
            (entry.prerequisite === undefined ||
              !isActive(entry.prerequisite.job)),
        );
        if (state === undefined) return;
        update({ state, patch: { stage: "running" }, isStageChange: true });
        const end: Partial<InstallJob> = await runTarget(state).then(
          () => ({ stage: "done", progress: 1 }),
          (error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            addLine({ state, line: message });
            return { stage: "failed", error: message };
          },
        );
        if (controller.signal.aborted) return;
        await options
          .onJobEnd(state.job.target)
          .catch((error: unknown) =>
            options.logger.error(
              `preflight after install failed: ${String(error)}`,
            ),
          );
        update({ state, patch: end, isStageChange: true });
      }
    } finally {
      isPumping = false;
    }
  }

  function findState(jobId: string) {
    const state = states.find((entry) => entry.job.id === jobId);
    if (state === undefined) throw new Error(`Unknown install job: ${jobId}`);
    return state;
  }

  function enqueue(input: {
    target: InstallTarget;
    prerequisite?: JobState | undefined;
  }) {
    const { target, prerequisite } = input;
    if ("modelId" in target) findModel(target.modelId);
    const key = targetKey(target);
    const existing = states.find(
      (state) => isActive(state.job) && targetKey(state.job.target) === key,
    );
    if (existing !== undefined) {
      if (existing.job.stage === "queued" && prerequisite !== undefined)
        existing.prerequisite = prerequisite;
      return existing;
    }
    if (
      target.kind === "weights-delete" &&
      states.some(
        (state) =>
          isActive(state.job) &&
          state.job.target.kind === "weights-download" &&
          state.job.target.modelId === target.modelId,
      )
    )
      throw new Error(
        "These weights are downloading; wait for the download to end",
      );
    const createdAt = new Date().toISOString();
    const state: JobState = {
      job: {
        id: randomUUID(),
        kind: "install",
        target,
        stage: "queued",
        progress: 0,
        createdAt,
        updatedAt: createdAt,
      },
      prerequisite,
      log: { firstLineIndex: 0, lines: [] },
      unsent: { firstLineIndex: 0, lines: [] },
      flushTimer: undefined,
      updateTimer: undefined,
      lastUpdateAtMs: 0,
    };
    states.push(state);
    publishJob(state);
    return state;
  }

  function startPump() {
    pump().catch((error: unknown) =>
      options.logger.error(`install queue failed: ${String(error)}`),
    );
  }

  return {
    list: () => states.map((state) => state.job),
    start(target: InstallTarget) {
      const state = enqueue({ target });
      startPump();
      return { jobId: state.job.id };
    },
    startBatch(targets: InstallTarget[]) {
      for (const target of targets) {
        if (target.kind === "weights-delete")
          throw new Error("Setup can only install tools and download models.");
        if ("modelId" in target) findModel(target.modelId);
      }
      const uv = targets.find((target) => target.kind === "uv");
      const python = targets.find((target) => target.kind === "python-env");
      const uvJob = uv && enqueue({ target: uv });
      const pythonJob =
        python && enqueue({ target: python, prerequisite: uvJob });
      const pending = targets.map((target) => {
        if (target.kind === "uv") return uvJob ?? enqueue({ target });
        if (target.kind === "python-env")
          return pythonJob ?? enqueue({ target });
        return enqueue({
          target,
          prerequisite:
            target.kind === "weights-download" ? pythonJob : undefined,
        });
      });
      startPump();
      return { jobIds: [...new Set(pending.map((entry) => entry.job.id))] };
    },
    readLog(jobId: string): InstallLogResult {
      const state = findState(jobId);
      return {
        firstLineIndex: state.log.firstLineIndex,
        lines: [...state.log.lines],
      };
    },
    stopAll() {
      controller.abort();
      for (const state of states) {
        clearTimeout(state.flushTimer);
        clearTimeout(state.updateTimer);
      }
    },
  };
}
