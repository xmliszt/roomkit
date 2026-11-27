import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { BulbJob } from "@planner/shared/src/jobs/job-schema.ts";
import { getBeamWay } from "@planner/shared/src/scene/get-beam-way.ts";
import { getDefaultLight } from "@planner/shared/src/scene/get-default-light.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { ChatStore } from "../chat/create-chat-store.ts";
import type { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import type { Logger } from "../util/logger.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { buildBulbPrompt, bulbSystemPrompt } from "./build-bulb-prompt.ts";
import { type BulbRecord, BulbRecordSchema } from "./bulb-record-schema.ts";
import { readBulbAnswer } from "./read-bulb-answer.ts";

const activeStages: BulbJob["stage"][] = ["queued", "rendering", "asking"];
const turnTimeoutMs = 120_000;

/** The front and side views of an item's model for the bulb turn, or the notice that says what is missing to render them. */
export type BulbViews =
  | { kind: "rendered"; frontPath: string; sidePath: string }
  | { kind: "missing"; notice: Extract<ChatBlock, { kind: "notice" }> };

function formatLight(light: Light) {
  const position = (["x", "y", "z"] as const)
    .map((axis) => `${axis} ${Math.round(light.emitter[axis] * 100)}%`)
    .join(", ");
  const beam =
    light.beam === undefined
      ? "all directions"
      : `${getBeamWay(light.beam)} ${Math.round(light.beam.angleDeg)}°`;
  return `${position}, ${beam}, ${light.shade ?? "opaque"} shade, ${light.lumens} lm`;
}

export function createBulbQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  logger: Logger;
  runtime: ReturnType<typeof createAgentRuntime>;
  config: () => Config;
  env: NodeJS.ProcessEnv;
  agentSlots: ReturnType<typeof createTurnSlots>;
  renderViews: (input: {
    modelPath: string;
    folder: string;
    signal: AbortSignal;
    onLine: (line: string) => void;
  }) => Promise<BulbViews>;
}) {
  const records: BulbRecord[] = [];
  const appendLog = createJobOutputLog({ bus: options.bus, env: options.env });
  const running: { [jobId: string]: AbortController } = Object.create(null);
  const removed = new Set<string>();
  const shutdown = new AbortController();
  const promises = new Set<Promise<void>>();

  function folder(record: BulbRecord) {
    return join(
      options.store.projectPath(record.job.projectId),
      ".planner",
      "bulbs",
      record.job.id,
    );
  }
  function save(projectId: string) {
    if (!removed.has(projectId))
      writeProjectJobRecords({
        folder: options.store.projectPath(projectId),
        kind: "bulb",
        records: records.filter((record) => record.job.projectId === projectId),
      });
  }
  function update(input: {
    record: BulbRecord;
    patch: Partial<
      Pick<BulbJob, "stage" | "progress" | "error" | "lastLogLine">
    >;
  }) {
    input.record.job = {
      ...input.record.job,
      ...input.patch,
      updatedAt: new Date().toISOString(),
    };
    save(input.record.job.projectId);
    options.bus.publish({ kind: "job.updated", job: input.record.job });
  }
  function log(input: { record: BulbRecord; line: string }) {
    appendLog({
      jobId: input.record.job.id,
      path: join(folder(input.record), "worker.log"),
      line: input.line,
    });
  }
  function isActive(record: BulbRecord) {
    return activeStages.includes(record.job.stage);
  }
  function currentItem(record: BulbRecord) {
    return options.store
      .loadProject(record.job.projectId)
      .scene.items.find((item) => item.id === record.job.itemId);
  }
  function message(record: BulbRecord) {
    if (
      options.chat
        .list(record.job.projectId)
        .some((entry) => entry.id === record.job.id)
    )
      return;
    options.chat.add({
      projectId: record.job.projectId,
      message: {
        id: record.job.id,
        author: { kind: "agent", role: "designer" },
        createdAt: record.job.createdAt,
        status: "streaming",
        blocks: [{ kind: "job", jobId: record.job.id }],
      },
    });
  }
  function finish(input: {
    record: BulbRecord;
    stage: "done" | "failed" | "cancelled";
    line: string;
    block?: ChatBlock;
  }) {
    message(input.record);
    if (input.block)
      options.chat.setBlock({
        projectId: input.record.job.projectId,
        messageId: input.record.job.id,
        blockIndex: 1,
        block: input.block,
      });
    options.chat.finish({
      projectId: input.record.job.projectId,
      messageId: input.record.job.id,
      status: input.stage === "failed" ? "failed" : "done",
    });
    update({
      record: input.record,
      patch: {
        stage: input.stage,
        progress: 1,
        lastLogLine: input.line,
        ...(input.stage === "failed" ? { error: input.line } : {}),
      },
    });
  }
  function publish(record: BulbRecord) {
    const outcome = record.outcome;
    if (outcome === undefined) throw new Error("The bulb has no answer yet");
    if (outcome.kind === "kept-default") {
      finish({ record, stage: "done", line: "kept the mount default" });
      return;
    }
    const project = options.store.loadProject(record.job.projectId);
    const item = currentItem(record);
    const light = item?.light;
    const placed =
      light &&
      (() => {
        const { beam: currentBeam, ...rest } = light;
        const beam =
          outcome.beam === undefined
            ? currentBeam
            : (outcome.beam ?? undefined);
        const isLumensUntouched =
          record.isLumensDefaultAtStart === true &&
          rest.lumens === record.lumensAtStart;
        return {
          ...rest,
          emitter: outcome.emitter,
          ...(beam === undefined ? {} : { beam }),
          ...(outcome.shade === undefined ? {} : { shade: outcome.shade }),
          ...(outcome.lumens !== undefined && isLumensUntouched
            ? { lumens: outcome.lumens }
            : {}),
        };
      })();
    const isApplied =
      (outcome.revision !== undefined &&
        project.revision >= outcome.revision) ||
      (light !== undefined && isDeepStrictEqual(light, placed));
    if (isApplied) {
      finish({ record, stage: "done", line: "placed the bulb" });
      return;
    }
    if (
      item === undefined ||
      light === undefined ||
      placed === undefined ||
      item.model.kind !== "asset" ||
      item.model.assetId !== record.assetId ||
      !isDeepStrictEqual(light.emitter, record.emitterAtStart)
    ) {
      finish({ record, stage: "done", line: "skipped: the item changed" });
      return;
    }
    const command = {
      type: "item.update",
      itemId: item.id,
      patch: { light: placed },
    } satisfies Command;
    const undo = invertCommand({ scene: project.scene, command });
    if (undo === undefined) throw new Error("Cannot undo the bulb placement");
    const { revision } = options.store.applyCommand({
      projectId: record.job.projectId,
      command,
      requestId: undefined,
    });
    record.outcome = { ...outcome, revision };
    save(record.job.projectId);
    options.store.flush();
    finish({
      record,
      stage: "done",
      line: "placed the bulb",
      block: {
        kind: "diff",
        changes: [
          {
            label: "Place bulb",
            before: formatLight(light),
            after: formatLight(placed),
          },
        ],
        undo: [undo],
      },
    });
  }
  async function ask(input: {
    record: BulbRecord;
    views: { frontPath: string; sidePath: string };
    signal: AbortSignal;
  }) {
    const release = await options.agentSlots.acquire(input.signal);
    if (!release) input.signal.throwIfAborted();
    try {
      update({
        record: input.record,
        patch: { stage: "asking", progress: 0.6 },
      });
      const item = currentItem(input.record);
      if (item === undefined) throw new Error("The item was removed");
      const role = options.config().roles.designer;
      const result = await options.runtime.runTurn({
        project: options.store.projectPath(input.record.job.projectId),
        cwd: folder(input.record),
        session: {
          id: `designer-bulb-${input.record.job.id}-1`,
          role: "designer",
          cli: role.cli,
        },
        model: role.model,
        systemPrompt: bulbSystemPrompt,
        prompt: buildBulbPrompt({ item, ...input.views }),
        allowedTools: role.cli === "claude" ? ["Read"] : [],
        imagePaths:
          role.cli === "codex"
            ? [input.views.frontPath, input.views.sidePath]
            : [],
        readableDirs: [folder(input.record)],
        readOnly: true,
        timeoutMs: turnTimeoutMs,
        signal: input.signal,
        onEvent(event) {
          if (event.kind === "assistant_text")
            log({ record: input.record, line: event.text });
        },
      });
      input.signal.throwIfAborted();
      if (result.finalText)
        log({ record: input.record, line: result.finalText });
      if (result.isError || result.interrupted || result.usageLimit)
        throw new Error(
          result.usageLimit
            ? `Designer usage limit reached${result.usageLimit.resetsAt ? `; resets at ${result.usageLimit.resetsAt}` : ""}`
            : `The designer could not answer: ${result.finalText.slice(-300)}`,
        );
      return result.finalText;
    } finally {
      release?.();
    }
  }
  async function execute(record: BulbRecord, signal: AbortSignal) {
    try {
      if (record.outcome) {
        publish(record);
        return;
      }
      const item = currentItem(record);
      if (item?.light === undefined || item.model.kind !== "asset")
        throw new Error("The item has no model or no light");
      record.assetId = item.model.assetId;
      record.emitterAtStart = item.light.emitter;
      record.lumensAtStart = item.light.lumens;
      record.isLumensDefaultAtStart =
        item.light.lumens === getDefaultLight(item.placement).lumens;
      mkdirSync(folder(record), { recursive: true });
      message(record);
      update({
        record,
        patch: { stage: "rendering", progress: 0.2, error: undefined },
      });
      const views = await options.renderViews({
        modelPath: join(
          options.store.projectPath(record.job.projectId),
          "assets",
          item.model.assetId,
          "model.glb",
        ),
        folder: folder(record),
        signal,
        onLine: (line) => log({ record, line }),
      });
      signal.throwIfAborted();
      if (views.kind === "missing") {
        finish({
          record,
          stage: "failed",
          line: views.notice.text,
          block: views.notice,
        });
        return;
      }
      const text = await ask({ record, views, signal });
      const answer = readBulbAnswer(text);
      record.outcome = answer
        ? {
            kind: "placed",
            emitter: answer.emitter,
            ...(answer.beam === undefined ? {} : { beam: answer.beam }),
            ...(answer.shade === undefined ? {} : { shade: answer.shade }),
            ...(answer.lumens === undefined ? {} : { lumens: answer.lumens }),
          }
        : { kind: "kept-default", reason: "no valid answer" };
      save(record.job.projectId);
      publish(record);
    } catch (error) {
      if (
        removed.has(record.job.projectId) ||
        shutdown.signal.aborted ||
        record.job.stage === "cancelled"
      )
        return;
      const isItemGone = (() => {
        try {
          return currentItem(record)?.light === undefined;
        } catch {
          return false;
        }
      })();
      if (isItemGone) {
        finish({ record, stage: "done", line: "skipped: the item changed" });
        return;
      }
      finish({
        record,
        stage: "failed",
        line: error instanceof Error ? error.message : String(error),
        block: {
          kind: "notice",
          detail: { kind: "error" },
          text: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  function cancelRecord(record: BulbRecord) {
    running[record.job.id]?.abort();
    finish({ record, stage: "cancelled", line: "cancelled" });
  }
  function pump() {
    if (shutdown.signal.aborted) return;
    for (const record of records) {
      if (Object.keys(running).length > 0) return;
      if (removed.has(record.job.projectId) || record.job.stage !== "queued")
        continue;
      const item = currentItem(record);
      if (item === undefined || item.light === undefined) {
        cancelRecord(record);
        continue;
      }
      if (item.model.kind !== "asset" && record.outcome === undefined) continue;
      const controller = new AbortController();
      running[record.job.id] = controller;
      const promise = execute(
        record,
        AbortSignal.any([controller.signal, shutdown.signal]),
      )
        .catch((error) => options.logger.error(String(error)))
        .finally(() => {
          delete running[record.job.id];
          promises.delete(promise);
          pump();
        });
      promises.add(promise);
    }
  }
  function find(input: { projectId: string; itemId: string }) {
    const item = options.store
      .loadProject(input.projectId)
      .scene.items.find((candidate) => candidate.id === input.itemId);
    if (item === undefined) throw new Error("Unknown item in this project");
    if (item.light === undefined) throw new Error("This item has no light");
    const active = records.find(
      (record) =>
        record.job.projectId === input.projectId &&
        record.job.itemId === input.itemId &&
        isActive(record),
    );
    if (active) return { jobId: active.job.id };
    const now = new Date().toISOString();
    const record: BulbRecord = {
      job: {
        id: randomUUID(),
        kind: "bulb",
        projectId: input.projectId,
        itemId: input.itemId,
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
    };
    records.push(record);
    try {
      save(input.projectId);
    } catch (error) {
      records.splice(records.indexOf(record), 1);
      throw error;
    }
    message(record);
    options.bus.publish({ kind: "job.updated", job: record.job });
    pump();
    return { jobId: record.job.id };
  }
  function findQuietly(input: { projectId: string; itemId: string }) {
    try {
      find(input);
    } catch (error) {
      options.logger.warn(String(error));
    }
  }
  return {
    list: () =>
      records
        .filter((record) => !removed.has(record.job.projectId))
        .map((record) => record.job),
    find,
    cancel(input: { projectId: string; jobId: string }) {
      const record = records.find(
        (candidate) =>
          candidate.job.projectId === input.projectId &&
          candidate.job.id === input.jobId,
      );
      if (!record) throw new Error("Unknown job in this project");
      if (!isActive(record))
        throw new Error("This bulb job has already finished");
      cancelRecord(record);
      return { jobId: record.job.id, stage: record.job.stage };
    },
    /** Start a bulb job when `command` gave an item with a `light` a new model, and settle queued jobs whose item changed. */
    sceneChanged(input: { projectId: string; command: Command }) {
      const command = input.command;
      const model =
        command.type === "item.update" ? command.patch.model : undefined;
      if (
        command.type === "item.update" &&
        model?.kind === "asset" &&
        options.store
          .loadProject(input.projectId)
          .scene.items.find((item) => item.id === command.itemId)?.light
      ) {
        for (const record of records.filter(
          (candidate) =>
            candidate.job.projectId === input.projectId &&
            candidate.job.itemId === command.itemId &&
            isActive(candidate) &&
            candidate.assetId !== undefined &&
            candidate.assetId !== model.assetId,
        ))
          cancelRecord(record);
        findQuietly({ projectId: input.projectId, itemId: command.itemId });
      }
      for (const record of records.filter(
        (candidate) =>
          candidate.job.projectId === input.projectId &&
          candidate.job.stage === "queued" &&
          !running[candidate.job.id],
      )) {
        const item = currentItem(record);
        if (item?.light === undefined) cancelRecord(record);
      }
      pump();
    },
    lightAdded: findQuietly,
    async resume() {
      for (const project of options.store.listProjects()) {
        for (const stored of readProjectJobRecords(
          options.store.projectPath(project.id),
        )) {
          if (stored.job.kind !== "bulb") continue;
          const record = BulbRecordSchema.parse(stored);
          if (record.job.projectId !== project.id)
            throw new Error("Bulb job belongs to another project");
          records.push(
            isActive(record)
              ? {
                  ...record,
                  job: { ...record.job, stage: "queued", progress: 0 },
                }
              : record,
          );
        }
        save(project.id);
      }
      pump();
    },
    remove(projectId: string) {
      removed.add(projectId);
      for (const record of records.filter(
        (candidate) => candidate.job.projectId === projectId,
      ))
        running[record.job.id]?.abort();
    },
    async stopAll() {
      shutdown.abort();
      await Promise.all(promises);
    },
  };
}
