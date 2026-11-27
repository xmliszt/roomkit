import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { AgentChatBlock } from "@planner/shared/src/chat/agent-chat-block-schema.ts";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { InventoryObject } from "@planner/shared/src/inventory/inventory-object-schema.ts";
import { InventoryObjectsSchema } from "@planner/shared/src/inventory/inventory-objects-schema.ts";
import type { InventoryJob } from "@planner/shared/src/jobs/job-schema.ts";
import { z } from "zod";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { ChatStore } from "../chat/create-chat-store.ts";
import type { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { unfurlLinkBlock } from "../links/unfurl-link-block.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { buildMissingRequirementNotice } from "../preflight/build-missing-requirement-notice.ts";
import type { ModelRegistry } from "../preflight/read-model-registry.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";
import { checkReconstructionRequirements } from "../reconstruction/check-reconstruction-requirements.ts";
import { JobRecordSchema } from "../reconstruction/job-record-schema.ts";
import { formatSize } from "../util/format-size.ts";
import type { Logger } from "../util/logger.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import type { EventBus } from "../ws/event-bus.ts";
import {
  type InventoryRecord,
  InventoryRecordSchema,
} from "./inventory-record-schema.ts";
import { runInventoryMeasurement } from "./run-inventory-measurement.ts";
import { runSurveyorTurn } from "./run-surveyor-turn.ts";

export function createInventoryQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  logger: Logger;
  plannerHome: string;
  pythonProjectDir: string;
  registry: ModelRegistry;
  env: NodeJS.ProcessEnv;
  runtime: ReturnType<typeof createAgentRuntime>;
  config: () => Config;
  link: () => { wsUrl: string; token: string };
  rolePromptPath: string;
  workerSlots: ReturnType<typeof createTurnSlots>;
  agentSlots: ReturnType<typeof createTurnSlots>;
  linkAllowedHosts: string[];
  onCompleted?: (projectId: string) => void;
  generationOwns?: (jobId: string) => boolean;
}) {
  const records: InventoryRecord[] = [];
  const removed = new Set<string>();
  const shutdown = new AbortController();
  const controllers: { [jobId: string]: AbortController } = {};
  const turns: {
    [projectId: string]: {
      turnId: string;
      record: InventoryRecord;
      signal: AbortSignal;
    };
  } = {};
  const appendLog = createJobOutputLog({ bus: options.bus, env: options.env });
  const processPath = join(options.plannerHome, "python-worker.json");
  const lastProgressAtMs: { [jobId: string]: number } = {};
  let pumping: Promise<void> | undefined;

  function save(projectId: string) {
    if (removed.has(projectId)) return;
    options.store.loadProject(projectId);
    writeProjectJobRecords({
      folder: options.store.projectPath(projectId),
      kind: "inventory",
      records: records.filter((record) => record.job.projectId === projectId),
    });
  }

  function update(input: {
    record: InventoryRecord;
    patch: Partial<InventoryJob>;
  }) {
    const nowMs = Date.now();
    if (
      input.patch.stage === input.record.job.stage &&
      input.patch.progress !== 1 &&
      nowMs - (lastProgressAtMs[input.record.job.id] ?? 0) < 250
    )
      return;
    lastProgressAtMs[input.record.job.id] = nowMs;
    input.record.job = {
      ...input.record.job,
      ...input.patch,
      updatedAt: new Date().toISOString(),
    };
    save(input.record.job.projectId);
    options.bus.publish({ kind: "job.updated", job: input.record.job });
  }

  function photos(record: InventoryRecord) {
    const accepted = readPhotos(options.store.projectPath(record.job.projectId))
      .filter((photo) => photo.kind === "accepted")
      .filter(
        (photo) =>
          photo.origin === "capture" && record.photoIds.includes(photo.photoId),
      );
    if (accepted.length !== record.photoIds.length)
      throw new Error("Inventory capture photos are no longer available");
    return accepted;
  }

  function ensureMessage(record: InventoryRecord) {
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

  function finish(input: {
    record: InventoryRecord;
    blocks: ChatBlock[];
    failed?: boolean;
  }) {
    ensureMessage(input.record);
    for (const block of input.blocks)
      options.chat.appendBlock({
        projectId: input.record.job.projectId,
        messageId: input.record.job.id,
        block,
      });
    options.chat.finish({
      projectId: input.record.job.projectId,
      messageId: input.record.job.id,
      status: input.failed ? "failed" : "done",
    });
  }

  function failRequirement(input: {
    record: InventoryRecord;
    notice: Extract<ChatBlock, { kind: "notice" }>;
  }) {
    finish({ record: input.record, blocks: [input.notice], failed: true });
    update({
      record: input.record,
      patch: { stage: "failed", error: input.notice.text },
    });
  }

  function publishOutcome(record: InventoryRecord) {
    const outcome = record.outcome;
    if (!outcome) return;
    const projectId = record.job.projectId;
    ensureMessage(record);
    if (outcome.blockStartIndex === undefined) {
      outcome.blockStartIndex =
        options.chat
          .list(projectId)
          .find((message) => message.id === record.job.id)?.blocks.length ?? 1;
      save(projectId);
    }
    const blocks: ChatBlock[] = [
      ...(outcome.items.length
        ? [
            {
              kind: "diff",
              changes: outcome.items.map((item) => ({
                label: item.name,
                before: "Not in room",
                after: formatSize(item.sizeM),
              })),
              undo: outcome.undo,
            } satisfies ChatBlock,
          ]
        : []),
      ...outcome.blocks,
    ];
    for (const [index, block] of blocks.entries())
      options.chat.setBlock({
        projectId,
        messageId: record.job.id,
        blockIndex: outcome.blockStartIndex + index,
        block,
      });
  }

  function requireTurn(input: { projectId: string; turnId: string }) {
    const turn = Object.hasOwn(turns, input.projectId)
      ? turns[input.projectId]
      : undefined;
    if (!turn || turn.turnId !== input.turnId || turn.signal.aborted)
      throw new Error("This surveyor turn is not running");
    options.store.loadProject(input.projectId);
    return turn;
  }

  function cancelRemovedItems(record: InventoryRecord) {
    const project = options.store.loadProject(record.job.projectId);
    if (!record.outcome) return;
    for (const job of record.outcome.generationJobs) {
      if (options.generationOwns?.(job.id)) continue;
      const wasApplied =
        record.job.stage === "done" ||
        (project.inventory?.jobId === record.job.id &&
          project.inventory.appliedItemIds.includes(job.itemId));
      if (
        !wasApplied ||
        project.scene.items.some((item) => item.id === job.itemId) ||
        job.stage !== "queued"
      )
        continue;
      job.stage = "failed";
      job.error = "Item removed; generation cancelled";
      job.updatedAt = new Date().toISOString();
      save(project.id);
      options.bus.publish({ kind: "job.updated", job });
    }
  }

  async function execute(record: InventoryRecord) {
    const projectId = record.job.projectId;
    const controller = new AbortController();
    controllers[record.job.id] = controller;
    const signal = AbortSignal.any([shutdown.signal, controller.signal]);
    function ensureProject() {
      signal.throwIfAborted();
      options.store.loadProject(projectId);
    }
    try {
      ensureProject();
      update({ record, patch: { stage: "surveying" } });
      ensureMessage(record);
      if (!record.outcome) {
        if (!record.submission) {
          const role = options.config().roles.surveyor;
          const binary = resolveExecutable({
            env: options.env,
            command:
              (role.cli === "claude"
                ? options.env.PLANNER_CLAUDE_BIN
                : options.env.PLANNER_CODEX_BIN) ?? role.cli,
          });
          try {
            accessSync(binary, constants.X_OK);
          } catch {
            const missing = {
              state: "missing",
              path: binary,
              message: "Agent executable unavailable",
            } satisfies { state: "missing"; path: string; message: string };
            const notice = buildMissingRequirementNotice({
              preflight: {
                checkedAt: new Date().toISOString(),
                agents: [],
                blender: missing,
                uv: missing,
                pythonEnv: missing,
                models: [],
              },
              requirements: [{ kind: "agent", cli: role.cli }],
            });
            if (notice) failRequirement({ record, notice });
            return;
          }
          update({ record, patch: { stage: "surveying", progress: 0.05 } });
          const turnId = randomUUID();
          turns[projectId] = { turnId, record, signal };
          try {
            await runSurveyorTurn({
              projectId,
              projectFolder: options.store.projectPath(projectId),
              turnId,
              photos: photos(record),
              role,
              runtime: options.runtime,
              slots: options.agentSlots,
              link: options.link(),
              rolePromptPath: options.rolePromptPath,
              signal,
              onText(text) {
                ensureProject();
                options.chat.appendText({
                  projectId,
                  messageId: record.job.id,
                  text,
                });
              },
            });
          } finally {
            delete turns[projectId];
          }
          ensureProject();
          if (!record.submission)
            throw new Error(
              "Surveyor finished without submitting an inventory",
            );
        }
        const managed = join(
          options.plannerHome,
          "python",
          ".venv",
          "bin",
          "python",
        );
        const python =
          options.env.PLANNER_PYTHON_BIN ??
          (existsSync(managed) || options.env.NODE_ENV === "production"
            ? managed
            : join(options.pythonProjectDir, ".venv", "bin", "python"));
        const weightsRoot =
          options.env.PLANNER_WEIGHTS_DIR ??
          join(options.plannerHome, "python", "weights");
        const requirements = record.submission.length
          ? checkReconstructionRequirements({
              python,
              weightsRoot,
              registry: options.registry,
              hasFurniture: true,
              needsGeometry: false,
            })
          : undefined;
        if (requirements?.notice) {
          failRequirement({ record, notice: requirements.notice });
          return;
        }
        const measured = await (async () => {
          const release = await options.workerSlots.acquire(signal);
          if (!release) {
            signal.throwIfAborted();
            throw new Error("Worker slot unavailable");
          }
          try {
            await stopOrphanWorker(processPath);
            return await runInventoryMeasurement({
              onLine(line) {
                appendLog({
                  jobId: record.job.id,
                  path: join(
                    options.store.projectPath(projectId),
                    ".planner",
                    "inventory",
                    record.job.id,
                    "worker.log",
                  ),
                  line,
                });
              },
              folder: options.store.projectPath(projectId),
              jobId: record.job.id,
              objects: record.submission ?? [],
              photos: photos(record),
              scenePath: record.scenePath,
              room: record.room,
              python,
              workersDir: join(options.pythonProjectDir, "workers"),
              weightsRoot,
              segmentationModel: requirements?.segmentationModel ?? "sam3",
              processPath,
              env: options.env,
              timeoutMs: z.coerce
                .number()
                .int()
                .positive()
                .parse(options.env.PLANNER_PYTHON_TIMEOUT_MS ?? 600000),
              signal,
              onProgress(patch) {
                ensureProject();
                update({ record, patch });
              },
            });
          } finally {
            release();
          }
        })();
        ensureProject();
        const now = new Date().toISOString();
        const objects = measured.objects.map((measurement) => {
          const source = record.submission?.find(
            (object) => object.objectId === measurement.objectId,
          );
          if (!source)
            throw new Error("Measurement names an unknown inventory object");
          return {
            item: {
              id: randomUUID(),
              name: source.name,
              model: { kind: "pending", jobId: randomUUID() },
              sizeM: measurement.sizeM,
              placement: measurement.placement,
              ...(source.cutsOpening ? { cutsOpening: true } : {}),
              locked: false,
            } satisfies NonNullable<
              InventoryRecord["outcome"]
            >["items"][number],
          };
        });
        record.outcome = {
          blockStartIndex:
            options.chat
              .list(projectId)
              .find((message) => message.id === record.job.id)?.blocks.length ??
            1,
          items: objects.map(({ item }) => item),
          objectIds: measured.objects.map((object) => object.objectId),
          generationJobs: objects.map(({ item }) => ({
            id: item.model.jobId,
            kind: "generation",
            projectId,
            itemId: item.id,
            stage: "queued",
            progress: 0,
            createdAt: now,
            updatedAt: now,
          })),
          undo: objects
            .toReversed()
            .map(({ item }) => ({ type: "item.remove", itemId: item.id })),
          blocks: [
            ...measured.failures.map(
              (failure) =>
                ({
                  kind: "text",
                  markdown: `${record.submission?.find((object) => object.objectId === failure.objectId)?.name ?? failure.objectId}: could not measure this object. ${failure.message}`,
                }) satisfies ChatBlock,
            ),
            ...record.submission
              .filter((object) =>
                object.views.every(
                  (view) => view.visibility === "more-than-half-hidden",
                ),
              )
              .map(
                (object) =>
                  ({
                    kind: "text",
                    markdown: `${object.name} is more than half hidden in every photo. Its box may be incomplete; replace it or add a clearer photo.`,
                  }) satisfies ChatBlock,
              ),
          ],
        };
        save(projectId);
      }
      ensureProject();
      const project = options.store.loadProject(projectId);
      if (
        project.reconstruction?.jobId !== record.job.reconstructionJobId ||
        JSON.stringify(project.scene.room.walls) !==
          JSON.stringify(record.room.walls) ||
        project.scene.room.ceilingHeightM !== record.room.ceilingHeightM
      )
        throw new Error(
          "The room changed during inventory. Run inventory again for the current room.",
        );
      const outcome = record.outcome;
      const appliedItemIds =
        project.inventory?.jobId === record.job.id
          ? [...project.inventory.appliedItemIds]
          : [];
      const pending = outcome.items.filter(
        (item) => !appliedItemIds.includes(item.id),
      );
      pending.reduce((scene, item) => {
        const result = applyCommand({
          scene,
          command: { type: "item.add", item },
        });
        if (result.kind === "rejected") throw new Error(result.reason);
        return result.scene;
      }, project.scene);
      update({ record, patch: { stage: "applying", progress: 0.95 } });
      for (const item of pending) {
        ensureProject();
        appliedItemIds.push(item.id);
        options.store.applyCommand({
          projectId,
          command: { type: "item.add", item },
          requestId: undefined,
          inventory: {
            jobId: record.job.id,
            appliedItemIds: [...appliedItemIds],
          },
        });
      }
      cancelRemovedItems(record);
      for (const job of outcome.generationJobs)
        options.bus.publish({ kind: "job.updated", job });
      publishOutcome(record);
      options.chat.finish({
        projectId,
        messageId: record.job.id,
        status: "done",
      });
      update({ record, patch: { stage: "done", progress: 1 } });
      options.onCompleted?.(projectId);
    } catch (error) {
      if (shutdown.signal.aborted || removed.has(projectId)) return;
      const text = `Inventory failed: ${error instanceof Error ? error.message : String(error)}`;
      finish({
        record,
        failed: true,
        blocks: [{ kind: "notice", text, detail: { kind: "error" } }],
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
      await execute(record);
      if (!removed.has(record.job.projectId) && !shutdown.signal.aborted)
        autoStart(record.job.projectId);
    }
  }
  function startPump() {
    pumping ??= Promise.resolve()
      .then(pump)
      .catch((error: unknown) =>
        options.logger.error(`Inventory queue stopped: ${String(error)}`),
      )
      .finally(() => {
        pumping = undefined;
      });
  }

  function start(projectId: string) {
    const project = options.store.loadProject(projectId);
    const reconstructionJobId = project.reconstruction?.jobId;
    if (!reconstructionJobId)
      throw new Error("Inventory needs a completed reconstruction");
    const existing = records.find(
      (record) =>
        record.job.projectId === projectId &&
        record.job.stage !== "done" &&
        record.job.stage !== "failed" &&
        record.job.stage !== "cancelled",
    );
    if (existing) return { jobId: existing.job.id };
    if (
      records.some(
        (record) =>
          record.job.projectId === projectId &&
          record.job.reconstructionJobId === reconstructionJobId &&
          record.job.stage === "done",
      )
    )
      throw new Error(
        "Inventory already applied for this reconstruction; replacement is not available",
      );
    const interrupted = records
      .toReversed()
      .find(
        (record) =>
          record.job.projectId === projectId &&
          record.job.reconstructionJobId === reconstructionJobId &&
          (record.job.stage === "failed" || record.job.stage === "cancelled") &&
          record.outcome,
      );
    if (
      interrupted &&
      JSON.stringify(interrupted.room.walls) ===
        JSON.stringify(project.scene.room.walls) &&
      interrupted.room.ceilingHeightM === project.scene.room.ceilingHeightM
    ) {
      update({
        record: interrupted,
        patch: { stage: "queued", error: undefined, progress: 0 },
      });
      startPump();
      return { jobId: interrupted.job.id };
    }
    if (
      interrupted &&
      project.inventory?.jobId === interrupted.job.id &&
      project.inventory.appliedItemIds.length
    )
      throw new Error(
        "Inventory was partly applied before the room changed. Restore its room dimensions before retrying inventory.",
      );
    const folder = options.store.projectPath(projectId);
    const reconstruction = readProjectJobRecords(folder)
      .filter((record) => record.job.kind === "reconstruction")
      .map((record) => JobRecordSchema.parse(record))
      .find(
        (record) =>
          record.job.id === reconstructionJobId && record.job.stage === "done",
      );
    if (!reconstruction)
      throw new Error("Inventory needs a completed reconstruction job");
    const artifacts = reconstruction.artifacts;
    if (!artifacts)
      throw new Error(
        "Reconstruct the room again to record the inventory artifact paths",
      );
    function artifact(path: string) {
      const fullPath = realpathSync(resolve(folder, "recon", path));
      if (!fullPath.startsWith(`${realpathSync(join(folder, "recon"))}${sep}`))
        throw new Error("Reconstruction artifact is outside the project");
      return fullPath;
    }
    const now = new Date().toISOString();
    const record: InventoryRecord = {
      job: {
        id: randomUUID(),
        kind: "inventory",
        projectId,
        reconstructionJobId,
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      photoIds: readPhotos(folder)
        .filter(
          (photo) =>
            photo.kind === "accepted" &&
            photo.origin === "capture" &&
            reconstruction.photoIds.includes(photo.photoId),
        )
        .map((photo) => photo.photoId),
      scenePath: artifact(artifacts.scenePath),
      camerasPath: artifact(artifacts.camerasPath),
      room: structuredClone(project.scene.room),
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
  }

  function autoStart(projectId: string) {
    const reconstructionJobId =
      options.store.loadProject(projectId).reconstruction?.jobId;
    if (
      records.some(
        (record) =>
          record.job.projectId === projectId &&
          record.job.reconstructionJobId === reconstructionJobId,
      )
    )
      return;
    try {
      start(projectId);
    } catch (error) {
      options.logger.error(`Could not start inventory: ${String(error)}`);
    }
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
    start,
    autoStart,
    list: () =>
      records
        .filter((record) => !removed.has(record.job.projectId))
        .flatMap((record) => {
          const receipt = options.store.loadProject(
            record.job.projectId,
          ).inventory;
          return [
            record.job,
            ...(record.outcome?.generationJobs ?? []).filter(
              (job) =>
                record.job.stage === "done" ||
                (receipt?.jobId === record.job.id &&
                  receipt.appliedItemIds.includes(job.itemId)),
            ),
          ];
        }),
    resume() {
      for (const project of options.store.listProjects()) {
        const saved = readProjectJobRecords(
          options.store.projectPath(project.id),
        )
          .filter((record) => record.job.kind === "inventory")
          .map((record) => InventoryRecordSchema.parse(record));
        if (saved.some((record) => record.job.projectId !== project.id))
          throw new Error("Inventory job belongs to another project");
        records.push(...saved);
        for (const record of saved) cancelRemovedItems(record);
      }
      startPump();
    },
    ownsTurn(input: { projectId: string; turnId: string }) {
      return (
        Object.hasOwn(turns, input.projectId) &&
        turns[input.projectId]?.turnId === input.turnId
      );
    },
    submit(input: {
      projectId: string;
      turnId: string;
      objects: InventoryObject[];
    }) {
      const { record } = requireTurn(input);
      const objects = InventoryObjectsSchema.parse(input.objects);
      const accepted = photos(record);
      for (const object of objects)
        for (const view of object.views) {
          const photo = accepted.find(
            (photo) => photo.photoId === view.photoId,
          );
          if (
            !photo ||
            view.box[2] > photo.visionWidthPx ||
            view.box[3] > photo.visionHeightPx
          )
            throw new Error(
              "Inventory box must fit a pinned capture photo's vision copy",
            );
        }
      if (
        record.submission &&
        JSON.stringify(record.submission) !== JSON.stringify(objects)
      )
        throw new Error("Inventory has already been submitted");
      if (!record.submission) {
        record.submission = objects;
        try {
          save(input.projectId);
        } catch (error) {
          record.submission = undefined;
          throw error;
        }
      }
      return { submitted: objects.length };
    },
    postBlocks(input: {
      projectId: string;
      turnId: string;
      blocks: AgentChatBlock[];
    }) {
      const { record } = requireTurn(input);
      for (const block of input.blocks) {
        const blockIndex = options.chat.appendBlock({
          projectId: input.projectId,
          messageId: record.job.id,
          block,
        });
        if (block.kind === "link")
          unfurlLinkBlock({
            block,
            projectFolder: options.store.projectPath(input.projectId),
            allowedHosts: options.linkAllowedHosts,
            logWarning: options.logger.warn,
          })
            .then((updated) => {
              if (!removed.has(input.projectId))
                options.chat.setBlock({
                  projectId: input.projectId,
                  messageId: record.job.id,
                  blockIndex,
                  block: updated,
                });
            })
            .catch((error: unknown) => options.logger.warn(String(error)));
      }
      return { posted: input.blocks.length };
    },
    itemRemoved(projectId: string) {
      try {
        for (const record of records.filter(
          (record) => record.job.projectId === projectId,
        )) {
          cancelRemovedItems(record);
        }
      } catch (error) {
        options.logger.error(
          `Could not update inventory after item removal: ${String(error)}`,
        );
      }
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
