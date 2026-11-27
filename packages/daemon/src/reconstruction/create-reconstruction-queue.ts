import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import {
  type ScaleSource,
  ScaleSourcesSchema,
} from "@planner/shared/src/reconstruction/scale-source-schema.ts";
import { z } from "zod";
import type { ChatStore } from "../chat/create-chat-store.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { readPhotos } from "../photos/read-photos.ts";
import type { ModelRegistry } from "../preflight/read-model-registry.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";
import type { Logger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { checkReconstructionRequirements } from "./check-reconstruction-requirements.ts";
import { type JobRecord, JobRecordSchema } from "./job-record-schema.ts";
import { runReconstruction } from "./run-reconstruction.ts";

export function createReconstructionQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  logger: Logger;
  plannerHome: string;
  pythonProjectDir: string;
  registry: ModelRegistry;
  env: NodeJS.ProcessEnv;
  workerSlots?: ReturnType<typeof createTurnSlots>;
  onCompleted?: (projectId: string) => void;
}) {
  const workerSlots = options.workerSlots ?? createTurnSlots({ size: 1 });
  const records: JobRecord[] = [];
  const removed = new Set<string>();
  const shutdown = new AbortController();
  const controllers: { [jobId: string]: AbortController } = {};
  const appendLog = createJobOutputLog({ bus: options.bus, env: options.env });
  const processPath = join(options.plannerHome, "python-worker.json");
  const managedPython = join(
    options.plannerHome,
    "python",
    ".venv",
    "bin",
    "python",
  );
  function resolvePython() {
    return (
      options.env.PLANNER_PYTHON_BIN ??
      (existsSync(managedPython) || options.env.NODE_ENV === "production"
        ? managedPython
        : join(options.pythonProjectDir, ".venv", "bin", "python"))
    );
  }
  const weightsRoot =
    options.env.PLANNER_WEIGHTS_DIR ??
    join(options.plannerHome, "python", "weights");
  const timeoutMs = z.coerce
    .number()
    .int()
    .positive()
    .parse(options.env.PLANNER_PYTHON_TIMEOUT_MS ?? 600_000);
  let pumping: Promise<void> | undefined;

  function save(projectId: string) {
    if (removed.has(projectId)) return;
    options.store.loadProject(projectId);
    writeProjectJobRecords({
      folder: options.store.projectPath(projectId),
      kind: "reconstruction",
      records: records.filter((record) => record.job.projectId === projectId),
    });
  }
  function update(input: {
    record: JobRecord;
    patch: Partial<ReconstructionJob>;
  }) {
    input.record.job = {
      ...input.record.job,
      ...input.patch,
      updatedAt: new Date().toISOString(),
    };
    save(input.record.job.projectId);
    options.bus.publish({ kind: "job.updated", job: input.record.job });
  }
  function ensureMessage(record: JobRecord) {
    if (
      options.chat
        .list(record.job.projectId)
        .some((message) => message.id === record.job.id)
    )
      return;
    options.chat.add({
      projectId: record.job.projectId,
      message: {
        id: record.job.id,
        author: { kind: "agent", role: "surveyor" },
        status: "streaming",
        createdAt: record.job.createdAt,
        blocks: [{ kind: "job", jobId: record.job.id }],
      },
    });
  }
  function finishMessage(input: {
    record: JobRecord;
    blocks: ChatBlock[];
    status: "done" | "failed";
  }) {
    ensureMessage(input.record);
    for (const [index, block] of input.blocks.entries())
      options.chat.setBlock({
        projectId: input.record.job.projectId,
        messageId: input.record.job.id,
        blockIndex: index + 1,
        block,
      });
    options.chat.finish({
      projectId: input.record.job.projectId,
      messageId: input.record.job.id,
      status: input.status,
    });
  }
  function validateSources(input: {
    projectId: string;
    sources: ScaleSource[];
  }) {
    const photos = readPhotos(options.store.projectPath(input.projectId));
    for (const source of input.sources) {
      if (source.kind !== "furniture") continue;
      const photo = photos.find(
        (photo) =>
          photo.photoId === source.photoId && photo.origin === "capture",
      );
      if (!photo || photo.kind !== "accepted")
        throw new Error(
          "Scale furniture needs an accepted capture photo from this project",
        );
      if (source.box[2] > photo.widthPx || source.box[3] > photo.heightPx)
        throw new Error("Scale box exceeds the upright photo dimensions");
    }
  }
  async function execute(record: JobRecord) {
    const projectId = record.job.projectId;
    const controller = new AbortController();
    controllers[record.job.id] = controller;
    function ensureProject() {
      shutdown.signal.throwIfAborted();
      controller.signal.throwIfAborted();
      options.store.loadProject(projectId);
    }
    try {
      if (!record.outcome) record.artifacts = undefined;
      update({
        record,
        patch: {
          stage: "intake",
          pointCloudReady: record.outcome
            ? record.job.pointCloudReady
            : undefined,
        },
      });
      ensureMessage(record);
      if (!record.outcome) {
        const python = resolvePython();
        const requirements = checkReconstructionRequirements({
          python,
          weightsRoot,
          registry: options.registry,
          hasFurniture: record.sources.some(
            (source) => source.kind === "furniture",
          ),
        });
        if (requirements.notice) {
          finishMessage({
            record,
            blocks: [requirements.notice],
            status: "failed",
          });
          update({
            record,
            patch: { stage: "failed", error: requirements.notice.text },
          });
          return;
        }
        const result = await runReconstruction({
          onLine(line) {
            appendLog({
              jobId: record.job.id,
              path: join(
                options.store.projectPath(projectId),
                ".planner",
                "reconstruction",
                record.job.id,
                "worker.log",
              ),
              line,
            });
          },
          folder: options.store.projectPath(projectId),
          jobId: record.job.id,
          photoIds: record.photoIds,
          sources: record.sources,
          python,
          workersDir: join(options.pythonProjectDir, "workers"),
          weightsRoot,
          processPath,
          env: options.env,
          timeoutMs,
          signal: AbortSignal.any([shutdown.signal, controller.signal]),
          segmentationModel: requirements.segmentationModel,
          ensureProject,
          onArtifacts(artifacts) {
            ensureProject();
            record.artifacts = artifacts;
            update({
              record,
              patch: {
                pointCloudReady: artifacts.pointsPath ? true : undefined,
              },
            });
          },
          onProgress: (patch) => update({ record, patch }),
        });
        ensureProject();
        const command = {
          type: "room.update",
          walls: result.room.walls,
          ceilingHeightM: result.room.ceilingHeightM,
        } satisfies NonNullable<JobRecord["outcome"]>["command"];
        const undo = invertCommand({
          scene: options.store.loadProject(projectId).scene,
          command,
        });
        if (!undo) throw new Error("Room update has no inverse");
        record.outcome = {
          command,
          undo,
          weakScale: result.room.scale.weak,
          blocks: result.blocks,
        };
        save(projectId);
      }
      ensureProject();
      const outcome = record.outcome;
      if (
        options.store.loadProject(projectId).reconstruction?.jobId !==
        record.job.id
      )
        options.store.applyCommand({
          projectId,
          command: outcome.command,
          requestId: undefined,
          reconstruction: {
            jobId: record.job.id,
            weakScale: outcome.weakScale,
          },
        });
      finishMessage({
        record,
        status: "done",
        blocks: [
          {
            kind: "diff",
            changes: [
              {
                label: "Room",
                before: "Previous room",
                after: "Reconstructed room",
              },
            ],
            undo: [outcome.undo],
          },
          ...outcome.blocks,
        ],
      });
      update({ record, patch: { stage: "done", progress: 1 } });
      options.onCompleted?.(projectId);
    } catch (error) {
      if (shutdown.signal.aborted || removed.has(projectId)) return;
      const text = `Reconstruction failed: ${error instanceof Error ? error.message : String(error)}. Enter width, depth and ceiling height in the room panel.`;
      finishMessage({
        record,
        blocks: [{ kind: "notice", text, detail: { kind: "error" } }],
        status: "failed",
      });
      update({ record, patch: { stage: "failed", error: text } });
    } finally {
      delete controllers[record.job.id];
    }
  }
  async function pump() {
    while (!shutdown.signal.aborted) {
      const record = records.find(
        (record) =>
          !removed.has(record.job.projectId) &&
          record.job.stage !== "done" &&
          record.job.stage !== "failed" &&
          record.job.stage !== "cancelled",
      );
      if (!record) return;
      const release = await workerSlots.acquire(shutdown.signal);
      if (!release) return;
      try {
        await stopOrphanWorker(processPath);
        if (
          record.job.stage === "cancelled" ||
          removed.has(record.job.projectId)
        )
          continue;
        await execute(record);
      } finally {
        release();
      }
    }
  }
  function startPump() {
    pumping ??= Promise.resolve()
      .then(pump)
      .catch((error: unknown) =>
        options.logger.error(`Reconstruction queue stopped: ${String(error)}`),
      )
      .finally(() => {
        pumping = undefined;
      });
  }
  return {
    cancel(input: { projectId: string; jobId: string }) {
      const record = records.find(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.id === input.jobId,
      );
      if (!record) throw new Error("Unknown job in this project");
      if (
        record.job.stage !== "queued" ||
        Object.hasOwn(controllers, record.job.id)
      )
        throw new Error(
          "Only queued jobs can be cancelled; this job has already started or finished",
        );
      update({ record, patch: { stage: "cancelled" } });
      return { jobId: record.job.id, stage: record.job.stage };
    },
    list: () =>
      records
        .filter((record) => !removed.has(record.job.projectId))
        .map((record) => record.job),
    async resume() {
      for (const project of options.store.listProjects()) {
        const saved = z
          .array(JobRecordSchema)
          .parse(
            readProjectJobRecords(options.store.projectPath(project.id)).filter(
              (record) => record.job.kind === "reconstruction",
            ),
          );
        if (saved.some((record) => record.job.projectId !== project.id))
          throw new Error("Reconstruction job belongs to another project");
        records.push(...saved);
      }
      for (const project of options.store.listProjects()) {
        const current = options.store.loadProject(project.id).reconstruction;
        if (
          records.some(
            (record) =>
              record.job.id === current?.jobId && record.job.stage === "done",
          )
        )
          options.onCompleted?.(project.id);
      }
      startPump();
    },
    setScale(input: { projectId: string; sources: ScaleSource[] }) {
      options.store.loadProject(input.projectId);
      const sources = ScaleSourcesSchema.parse(input.sources);
      validateSources({ ...input, sources });
      writeJson({
        path: join(
          options.store.projectPath(input.projectId),
          "recon",
          "scale-input.json",
        ),
        value: { sources },
      });
      return { sources };
    },
    start(projectId: string) {
      options.store.loadProject(projectId);
      const existing = records.find(
        (record) =>
          record.job.projectId === projectId &&
          record.job.stage !== "done" &&
          record.job.stage !== "failed" &&
          record.job.stage !== "cancelled",
      );
      if (existing) return { jobId: existing.job.id };
      const photos = readPhotos(options.store.projectPath(projectId)).filter(
        (photo) => photo.origin === "capture",
      );
      if (photos.length < 2)
        throw new Error("Reconstruction needs at least two capture photos");
      const scalePath = join(
        options.store.projectPath(projectId),
        "recon",
        "scale-input.json",
      );
      const sources = existsSync(scalePath)
        ? z
            .object({ sources: ScaleSourcesSchema })
            .parse(JSON.parse(readFileSync(scalePath, "utf8"))).sources
        : [];
      validateSources({ projectId, sources });
      const createdAt = new Date().toISOString();
      const record: JobRecord = {
        job: {
          kind: "reconstruction",
          id: randomUUID(),
          projectId,
          stage: "queued",
          progress: 0,
          createdAt,
          updatedAt: createdAt,
        },
        photoIds: photos.map((photo) => photo.photoId),
        sources,
      };
      records.push(record);
      try {
        save(projectId);
      } catch (error) {
        records.splice(records.indexOf(record), 1);
        throw error;
      }
      options.bus.publish({ kind: "job.updated", job: record.job });
      startPump();
      return { jobId: record.job.id };
    },
    remove(projectId: string) {
      removed.add(projectId);
      for (const record of records.filter(
        (record) => record.job.projectId === projectId,
      ))
        controllers[record.job.id]?.abort();
    },
    async stopAll() {
      shutdown.abort();
      await pumping;
    },
  };
}
