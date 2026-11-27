import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ROLE_TOOLS } from "@planner/mcp/src/role-tools.ts";
import { writeMcpConfig } from "@planner/mcp/src/write-mcp-config.ts";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { GenerationSpec } from "@planner/shared/src/generation/generation-spec-schema.ts";
import type { ModelerOperation } from "@planner/shared/src/generation/modeler-operation-schema.ts";
import type { VariantSpec } from "@planner/shared/src/generation/variant-spec-schema.ts";
import {
  type AssetMeta,
  AssetMetaSchema,
} from "@planner/shared/src/scene/asset-meta-schema.ts";
import { findSizeMismatches } from "@planner/shared/src/scene/find-size-mismatches.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { SizeMismatch } from "@planner/shared/src/scene/size-mismatch-schema.ts";
import sharp from "sharp";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { ChatStore } from "../chat/create-chat-store.ts";
import type { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { buildMissingRequirementNotice } from "../preflight/build-missing-requirement-notice.ts";
import { checkBlender } from "../preflight/check-blender.ts";
import { readModelRegistry } from "../preflight/read-model-registry.ts";
import { resolveToolPaths } from "../preflight/resolve-tool-paths.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";
import { formatSize } from "../util/format-size.ts";
import type { Logger } from "../util/logger.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { checkAlternativeRequirements } from "./check-alternative-requirements.ts";
import { checkGeneratedAsset } from "./check-generated-asset.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "./generation-record-schema.ts";
import { getGenerationTargetSize } from "./get-generation-target-size.ts";
import { getPublishedSize } from "./get-published-size.ts";
import { getSourcePhotoIds } from "./get-source-photo-ids.ts";
import { isFloorCovering } from "./is-floor-covering.ts";
import { jobFilePath } from "./job-file-path.ts";
import { mergeSourcePhotos } from "./merge-source-photos.ts";
import { prepareGenerationFolder } from "./prepare-generation-folder.ts";
import { readInventoryGenerations } from "./read-inventory-generations.ts";
import { readRegenerationSource } from "./read-regeneration-source.ts";
import { runAlternativeWorker } from "./run-alternative-worker.ts";
import { runGenerationProcess } from "./run-generation-process.ts";
import { stopAlternativeWorkers } from "./stop-alternative-workers.ts";

export function createGenerationQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  logger: Logger;
  runtime: ReturnType<typeof createAgentRuntime>;
  config: () => Config;
  env: NodeJS.ProcessEnv;
  plannerHome: string;
  allowedHosts: string[];
  agentSlots: ReturnType<typeof createTurnSlots>;
  workerSlots: ReturnType<typeof createTurnSlots>;
  link: () => { wsUrl: string; token: string };
}) {
  const records: GenerationRecord[] = [];
  const running: {
    [jobId: string]: { controller: AbortController; promise: Promise<void> };
  } = Object.create(null);
  const turns: {
    [turnId: string]: {
      record: GenerationRecord;
      folder: string;
      signal: AbortSignal;
      blender: string;
      submitted: boolean;
      busy: boolean;
    };
  } = Object.create(null);
  const shutdown = new AbortController();
  const removed = new Set<string>();
  const lastProgress: { [jobId: string]: number } = Object.create(null);
  const appendLog = createJobOutputLog({ bus: options.bus, env: options.env });
  const blenderDir = fileURLToPath(
    new URL("../../../../blender", import.meta.url),
  );
  const processPath = join(options.plannerHome, "generation-worker.json");
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  function folder(record: GenerationRecord) {
    return join(
      options.store.projectPath(record.job.projectId),
      ".planner",
      "generation",
      record.job.id,
    );
  }
  function save(projectId: string) {
    if (removed.has(projectId)) return;
    for (const kind of [
      "generation",
      "generation-alternative",
    ] satisfies GenerationRecord["job"]["kind"][])
      writeProjectJobRecords({
        folder: options.store.projectPath(projectId),
        kind,
        records: records.filter(
          (record) =>
            record.job.projectId === projectId && record.job.kind === kind,
        ),
      });
  }
  function log(input: { record: GenerationRecord; line: string }) {
    appendLog({
      jobId: input.record.job.id,
      path: join(folder(input.record), "worker.log"),
      line: input.line,
    });
  }
  function update(input: {
    record: GenerationRecord;
    patch: {
      stage?: "queued" | "generating" | "ready" | "failed";
      progress?: number;
      error?: string | undefined;
      lastLogLine?: string;
      superseded?: boolean;
      waitingFor?: "machine" | undefined;
    };
  }) {
    const { record, patch } = input;
    const isStageChange =
      patch.stage !== undefined && patch.stage !== record.job.stage;
    const isErrorChange =
      Object.hasOwn(patch, "error") && patch.error !== record.job.error;
    const isWaitingChange =
      "waitingFor" in patch && patch.waitingFor !== record.job.waitingFor;
    if (
      !isStageChange &&
      !isErrorChange &&
      !isWaitingChange &&
      patch.superseded === undefined &&
      Date.now() - (lastProgress[record.job.id] ?? 0) < 250
    )
      return;
    lastProgress[record.job.id] = Date.now();
    record.job = {
      ...record.job,
      ...(patch.stage ? { waitingFor: undefined } : {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    save(record.job.projectId);
    options.bus.publish({ kind: "job.updated", job: record.job });
  }
  function message(record: GenerationRecord) {
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
        author: { kind: "agent", role: "modeler" },
        createdAt: record.job.createdAt,
        status: "streaming",
        blocks: [{ kind: "job", jobId: record.job.id }],
      },
    });
  }
  function finish(input: {
    record: GenerationRecord;
    block: ChatBlock;
    failed?: boolean;
  }) {
    const { record, block, failed } = input;
    message(record);
    options.chat.setBlock({
      projectId: record.job.projectId,
      messageId: record.job.id,
      blockIndex: 1,
      block,
    });
    options.chat.finish({
      projectId: record.job.projectId,
      messageId: record.job.id,
      status: failed ? "failed" : "done",
    });
  }
  function item(record: GenerationRecord) {
    return options.store
      .loadProject(record.job.projectId)
      .scene.items.find((item) => item.id === record.job.itemId);
  }
  function ownsItem(input: { record: GenerationRecord; current: Item }) {
    const { record, current } = input;
    return (
      !record.job.superseded &&
      (record.job.kind !== "generation" ||
        (record.regeneration
          ? isDeepStrictEqual(current.model, record.item.model)
          : current.model.kind === "pending" &&
            current.model.jobId === record.job.id))
    );
  }
  function requireCurrentItem(record: GenerationRecord) {
    const current = item(record);
    if (!current || !ownsItem({ record, current })) {
      const error = "Item removed or replaced; generation cancelled";
      update({ record, patch: { stage: "failed", error, superseded: true } });
      throw new Error(error);
    }
    return current;
  }
  async function processRun(input: {
    record: GenerationRecord;
    signal: AbortSignal;
    command: string;
    args: string[];
    cwd?: string;
  }) {
    const release = await options.workerSlots.acquire(input.signal);
    if (!release) {
      input.signal.throwIfAborted();
      throw new Error("Worker slot unavailable");
    }
    try {
      await stopOrphanWorker(processPath);
      return await runGenerationProcess({
        command: input.command,
        args: input.args,
        cwd: input.cwd ?? folder(input.record),
        env: options.env,
        signal: input.signal,
        processPath,
        timeoutMs: 900000,
        onLine(line) {
          log({ record: input.record, line });
        },
      });
    } finally {
      release();
    }
  }
  function blenderRun(input: {
    record: GenerationRecord;
    signal: AbortSignal;
    blender: string;
    script: string;
    args: string[];
  }) {
    update({
      record: input.record,
      patch: {
        lastLogLine:
          input.script === join(blenderDir, "normalize.py")
            ? "normalizing"
            : "running Blender",
      },
    });
    return processRun({
      ...input,
      command: input.blender,
      args: [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python-expr",
        "import sys; sys.dont_write_bytecode = True",
        "--python",
        input.script,
        "--",
        ...input.args,
      ],
    });
  }
  async function modelerTurn(input: {
    record: GenerationRecord;
    signal: AbortSignal;
    blender: string;
  }) {
    const release = await options.agentSlots.acquire(input.signal);
    if (!release) {
      input.signal.throwIfAborted();
      throw new Error("Agent slot unavailable");
    }
    const turnId = randomUUID();
    const tools = ROLE_TOOLS.modeler.map((name) => `mcp__planner__${name}`);
    const role = options.config().roles.modeler;
    const turn = {
      ...input,
      folder: folder(input.record),
      submitted: false,
      busy: false,
    };
    turns[turnId] = turn;
    update({ record: input.record, patch: { lastLogLine: "modeling" } });
    const mcpDir = join(
      options.store.projectPath(input.record.job.projectId),
      ".planner",
      "sessions",
      `turn-${turnId}`,
    );
    try {
      const mcpConfigPath = writeMcpConfig({
        projectId: input.record.job.projectId,
        turnId,
        role: "modeler",
        allowedTools: tools,
        ...options.link(),
        dir: mcpDir,
      });
      const result = await options.runtime.runTurn({
        project: options.store.projectPath(input.record.job.projectId),
        cwd: turn.folder,
        session: { id: `modeler-${turnId}-1`, role: "modeler", cli: role.cli },
        model: role.model,
        systemPrompt:
          readFileSync(join(repo, "roles", "modeler.md"), "utf8") +
          "\nIn this daemon, use modeler_read to read files and images, modeler_write to write scripts and notes, blender_run to run a script, and modeler_preview for the compare loop. These MCP wrappers replace the two shell commands in job.json. Finish by calling asset_submit. There is no native shell access.",
        prompt: `Build the object in job.json. ${input.record.prompt}\n${input.record.gateFailure ? `The previous model failed the gate: ${input.record.gateFailure}. Fix it and submit again.` : ""}`,
        mcpConfigPath,
        allowedTools: tools,
        readOnly: true,
        signal: input.signal,
        onEvent(event) {
          if (event.kind === "assistant_text")
            log({ record: input.record, line: event.text });
        },
      });
      input.signal.throwIfAborted();
      if (result.isError || result.interrupted || result.usageLimit) {
        if (result.finalText)
          log({ record: input.record, line: result.finalText });
        throw new Error(
          result.usageLimit
            ? `Modeler usage limit reached${result.usageLimit.resetsAt ? `; resets at ${result.usageLimit.resetsAt}` : ""}; see the job log`
            : "Modeler failed; see the job log",
        );
      }
      if (!turn.submitted)
        throw new Error("Modeler finished without asset_submit");
    } finally {
      delete turns[turnId];
      release();
      rmSync(mcpDir, { recursive: true, force: true });
    }
  }
  function publish(record: GenerationRecord) {
    const meta = record.prepared;
    if (!meta) throw new Error("Generation asset has not passed the gate");
    const current = item(record);
    const displayedM = current?.sizeM ?? record.item.sizeM;
    const published =
      record.item.cutsOpening || current?.cutsOpening
        ? { sizeM: displayedM, isDisplayedSize: true }
        : record.job.kind === "generation" &&
            (record.regeneration !== undefined ||
              record.source.kind === "color")
          ? getPublishedSize({ displayedM, modelM: meta.nativeSizeM })
          : { sizeM: meta.nativeSizeM, isDisplayedSize: false };
    const keepsSize = published.isDisplayedSize;
    const sizeM = published.sizeM;
    if (record.job.kind === "generation") {
      const project = options.store.loadProject(record.job.projectId);
      const publication = record.regeneration?.publication;
      const alreadyApplied =
        publication?.kind === "applied" &&
        project.revision >= publication.revision;
      if (!alreadyApplied) {
        const command = {
          type: "item.update",
          itemId: record.job.itemId,
          patch: {
            model: { kind: "asset", assetId: meta.id },
            ...(keepsSize ? {} : { sizeM }),
          },
        } satisfies Command;
        const matchesAsset =
          current?.model.kind === "asset" && current.model.assetId === meta.id;
        if (!matchesAsset) requireCurrentItem(record);
        if (record.regeneration && !publication) {
          const undo = invertCommand({ scene: project.scene, command });
          if (!undo) throw new Error("Cannot restore the original item");
          record.regeneration.publication = { kind: "prepared", undo };
          save(record.job.projectId);
        }
        const revision = matchesAsset
          ? project.revision
          : options.store.applyCommand({
              projectId: record.job.projectId,
              requestId: undefined,
              command,
            }).revision;
        if (record.regeneration?.publication) {
          record.regeneration.publication = {
            kind: "applied",
            revision,
            undo: record.regeneration.publication.undo,
          };
          save(record.job.projectId);
        }
      }
      options.store.flush();
    } else requireCurrentItem(record);
    finish({
      record: record,
      block: {
        kind: "asset",
        assetId: meta.id,
        name: record.item.name,
        sizeM,
        ...(record.sizeMismatches?.length
          ? { sizeMismatches: record.sizeMismatches }
          : {}),
      },
    });
    if (record.regeneration?.publication) {
      const undo = record.regeneration.publication.undo;
      const sizeBeforeM =
        undo.type === "item.update" ? undo.patch.sizeM : undefined;
      options.chat.setBlock({
        projectId: record.job.projectId,
        messageId: record.job.id,
        blockIndex: 2,
        block: {
          kind: "diff",
          changes: [
            {
              label: `${record.item.name} model`,
              before:
                record.item.model.kind === "asset"
                  ? "original model"
                  : "failed model",
              after: "regenerated model",
            },
            ...(sizeBeforeM
              ? [
                  {
                    label: `${record.item.name} size`,
                    before: formatSize(sizeBeforeM),
                    after: formatSize(sizeM),
                  },
                ]
              : []),
          ],
          undo: [record.regeneration.publication.undo],
        },
      });
    }
    update({
      record: record,
      patch: { stage: "ready", progress: 1, error: undefined },
    });
  }
  function firstAttemptFolder(record: GenerationRecord) {
    return join(folder(record), "normalized-attempt-0");
  }
  function installAsset(input: {
    record: GenerationRecord;
    output: string;
    meta: AssetMeta;
    sizeMismatches: SizeMismatch[];
  }) {
    const destination = join(
      options.store.projectPath(input.record.job.projectId),
      "assets",
      input.record.assetId,
    );
    requireCurrentItem(input.record);
    rmSync(destination, { recursive: true, force: true });
    renameSync(input.output, destination);
    rmSync(firstAttemptFolder(input.record), { recursive: true, force: true });
    input.record.sizeMismatches = input.sizeMismatches;
    input.record.prepared = input.meta;
    save(input.record.job.projectId);
    publish(input.record);
  }
  function publishFirstAttempt(input: {
    record: GenerationRecord;
    signal: AbortSignal;
    reason: string;
  }) {
    const firstAttempt = input.record.firstAttempt;
    if (
      input.signal.aborted ||
      input.record.prepared ||
      input.record.attempt !== 1 ||
      !firstAttempt ||
      !existsSync(firstAttemptFolder(input.record))
    )
      return false;
    try {
      installAsset({
        record: input.record,
        output: firstAttemptFolder(input.record),
        meta: firstAttempt.meta,
        sizeMismatches: firstAttempt.sizeMismatches,
      });
    } catch (error) {
      log({
        record: input.record,
        line: `Could not publish the first attempt: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    log({
      record: input.record,
      line: `Retry failed (${input.reason}); published the first attempt. Size differs from the estimate: ${formatMismatches(firstAttempt.sizeMismatches)}`,
    });
    return true;
  }
  async function execute(record: GenerationRecord, signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      if (record.prepared) {
        publish(record);
        return;
      }
      const current = requireCurrentItem(record);
      if (current.cutsOpening || record.item.cutsOpening) record.item = current;
      message(record);
      const paths = resolveToolPaths({
        env: options.env,
        config: options.config(),
        plannerHome: options.plannerHome,
      });
      const blender = await checkBlender({
        candidates: paths.blender,
        env: options.env,
      });
      signal.throwIfAborted();
      const role = options.config().roles.modeler;
      const needsAgent =
        record.job.kind === "generation" && record.source.kind !== "color";
      const agentMissing = (() => {
        if (!needsAgent) return false;
        try {
          accessSync(
            resolveExecutable({
              env: options.env,
              command:
                (role.cli === "claude"
                  ? options.env.PLANNER_CLAUDE_BIN
                  : options.env.PLANNER_CODEX_BIN) ?? role.cli,
            }),
            constants.X_OK,
          );
          return false;
        } catch {
          return true;
        }
      })();
      const notice = buildMissingRequirementNotice({
        ...(record.job.kind === "generation-alternative"
          ? { setupFeature: record.job.method }
          : {}),
        preflight: {
          checkedAt: new Date().toISOString(),
          agents: [],
          blender,
          uv: blender,
          pythonEnv: blender,
          models: [],
        },
        requirements: [
          { kind: "blender" },
          ...(agentMissing
            ? [
                { kind: "agent", cli: role.cli } satisfies {
                  kind: "agent";
                  cli: "claude" | "codex";
                },
              ]
            : []),
        ],
      });
      if (notice) {
        if (publishFirstAttempt({ record, signal, reason: notice.text }))
          return;
        finish({ record, block: notice, failed: true });
        update({ record, patch: { stage: "failed", error: notice.text } });
        return;
      }
      const managedPython = join(
        options.plannerHome,
        "python",
        ".venv",
        "bin",
        "python",
      );
      const python =
        options.env.PLANNER_PYTHON_BIN ??
        (existsSync(managedPython) || options.env.NODE_ENV === "production"
          ? managedPython
          : join(repo, "python", ".venv", "bin", "python"));
      const weightsRoot =
        options.env.PLANNER_WEIGHTS_DIR ??
        join(options.plannerHome, "python", "weights");
      if (record.job.kind === "generation-alternative") {
        const alternativeNotice = checkAlternativeRequirements({
          python,
          weightsRoot,
          registry: readModelRegistry(options.env.PLANNER_MODEL_REGISTRY),
          method: record.job.method,
          hasMask: record.source.kind === "inventory",
        });
        if (alternativeNotice) {
          finish({ record, block: alternativeNotice, failed: true });
          update({
            record,
            patch: { stage: "failed", error: alternativeNotice.text },
          });
          return;
        }
      }
      const expected = getGenerationTargetSize(record);
      const copiedPhotos = await prepareGenerationFolder({
        record: { ...record, item: { ...record.item, sizeM: expected } },
        projectFolder: options.store.projectPath(record.job.projectId),
        folder: folder(record),
        blenderDir,
        allowedHosts: options.allowedHosts,
      });
      signal.throwIfAborted();
      update({
        record: record,
        patch: {
          stage: "generating",
          progress: record.job.kind === "generation-alternative" ? 0 : 0.05,
          ...(record.job.kind === "generation-alternative"
            ? { waitingFor: "machine" }
            : {}),
          error: undefined,
        },
      });
      const source = record.source;
      while (true) {
        signal.throwIfAborted();
        const sourceAxes = await (async () => {
          if (record.job.kind !== "generation-alternative") return undefined;
          const alternativeProcessPath = join(
            options.plannerHome,
            `alternative-worker-${record.job.id}.json`,
          );
          await stopOrphanWorker(alternativeProcessPath);
          return await runAlternativeWorker({
            record,
            folder: folder(record),
            python,
            repo,
            weightsRoot,
            env: options.env,
            signal,
            processPath: alternativeProcessPath,
            onLine(line) {
              log({ record, line });
            },
            onRetry() {
              save(record.job.projectId);
            },
            onProgress(progress) {
              const isWaiting = progress.waitingFor === "machine";
              update({
                record,
                patch: {
                  lastLogLine: isWaiting ? "queued" : progress.stage,
                  waitingFor: progress.waitingFor,
                  ...(isWaiting ? { progress: 0 } : {}),
                  ...(progress.progress === undefined
                    ? {}
                    : { progress: 0.05 + 0.6 * progress.progress }),
                },
              });
            },
          });
        })();
        if (record.job.kind === "generation-alternative") {
          signal.throwIfAborted();
        } else if (source.kind === "color") {
          const parent = jobFilePath({
            folder: options.store.projectPath(record.job.projectId),
            path: join("assets", source.parentAssetId, "model.glb"),
          });
          const recolored = await blenderRun({
            record,
            signal,
            blender: blender.path,
            script: join(blenderDir, "recolor.py"),
            args: [
              "--input",
              parent,
              "--output",
              join(folder(record), "raw.glb"),
              "--color",
              source.color,
              "--strength",
              String(source.strength),
              "--reference-luma",
              String(source.referenceLuma),
            ],
          });
          if (recolored.code !== 0)
            throw new Error(
              `Blender failed (${recolored.code}); see the job log`,
            );
        } else {
          rmSync(join(folder(record), "raw.glb"), { force: true });
          await modelerTurn({ record, signal, blender: blender.path });
        }
        signal.throwIfAborted();
        requireCurrentItem(record);
        update({ record, patch: { progress: 0.7 } });
        const output = join(folder(record), "normalized");
        if (record.job.kind === "generation-alternative")
          record.job = { ...record.job, hasRejectedModel: undefined };
        rmSync(output, { recursive: true, force: true });
        mkdirSync(output);
        try {
          const normalizedOutput = await blenderRun({
            record,
            signal,
            blender: blender.path,
            script: join(blenderDir, "normalize.py"),
            args: [
              "--input",
              join(folder(record), "raw.glb"),
              "--output",
              join(output, "model.glb"),
              ...(sourceAxes
                ? [
                    `--source-up=${sourceAxes.sourceUp}`,
                    `--source-front=${sourceAxes.sourceFront}`,
                  ]
                : []),
              "--mount",
              record.item.placement.kind,
              "--expected-size",
              String(Math.max(expected.width, expected.height, expected.depth)),
              "--expected-width",
              String(expected.width),
              "--expected-height",
              String(expected.height),
              "--expected-depth",
              String(expected.depth),
              ...(record.job.kind === "generation-alternative"
                ? ["--remove-remnants"]
                : []),
              ...(isFloorCovering({
                placementKind: record.item.placement.kind,
                sizeM: expected,
              })
                ? ["--floor-covering"]
                : []),
            ],
          });
          if (normalizedOutput.code !== 0)
            throw new Error(
              `Blender failed (${normalizedOutput.code}); see the job log`,
            );
          const resultLine = normalizedOutput.output
            .split("\n")
            .findLast((line) => line.startsWith("RESULT "));
          if (!resultLine)
            throw new Error("Normalization returned no metadata");
          const normalized = await checkGeneratedAsset({
            folder: output,
            placementKind: record.item.placement.kind,
            expected,
            normalized: JSON.parse(resultLine.slice(7)),
          }).catch((error: unknown) => {
            if (
              record.job.kind === "generation-alternative" &&
              existsSync(join(output, "model.glb")) &&
              existsSync(join(output, "thumb.png"))
            )
              record.job = { ...record.job, hasRejectedModel: true };
            throw error;
          });
          const mismatches = findSizeMismatches({
            expected,
            actual: normalized.nativeSizeM,
          });
          const mismatchText = formatMismatches(mismatches);
          const parentAssetId =
            source.kind === "color" || source.kind === "shape"
              ? source.parentAssetId
              : undefined;
          const meta = AssetMetaSchema.parse({
            id: record.assetId,
            kind: parentAssetId
              ? "variant"
              : source.kind === "inventory"
                ? "reconstructed"
                : "generated",
            nativeSizeM: normalized.nativeSizeM,
            triangleCount: normalized.triangleCount,
            mount: record.item.placement.kind,
            hasColorMask: normalized.hasColorMask,
            referenceLuma: normalized.referenceLuma,
            ...(parentAssetId ? { parentAssetId } : {}),
            provenance: {
              method:
                record.job.kind === "generation-alternative"
                  ? record.job.method
                  : source.kind === "color"
                    ? "recolor"
                    : "modeler",
              prompt: record.prompt,
              sourcePhotoIds: getSourcePhotoIds(source).filter(
                (photoId, index) =>
                  (index === 0 && copiedPhotos.length > 0) ||
                  copiedPhotos.includes(`photos/${photoId}.jpg`),
              ),
            },
          });
          writeJson({ path: join(output, "meta.json"), value: meta });
          mkdirSync(join(output, "source"));
          for (const name of [
            "job.json",
            "photos",
            "masks",
            "model.py",
            "notes.md",
          ]) {
            const path = join(folder(record), name);
            if (existsSync(path))
              cpSync(path, join(output, "source", name), { recursive: true });
          }
          if (
            mismatches.length > 0 &&
            record.job.kind === "generation" &&
            record.attempt === 0 &&
            source.kind !== "color"
          ) {
            rmSync(firstAttemptFolder(record), {
              recursive: true,
              force: true,
            });
            renameSync(output, firstAttemptFolder(record));
            record.firstAttempt = { meta, sizeMismatches: mismatches };
            throw new Error(`Wrong proportions: ${mismatchText} (±20%)`);
          }
          if (mismatches.length > 0)
            log({
              record,
              line: `Size differs from the estimate: ${mismatchText}`,
            });
          signal.throwIfAborted();
          installAsset({ record, output, meta, sizeMismatches: mismatches });
          return;
        } catch (error) {
          signal.throwIfAborted();
          if (
            record.prepared ||
            record.attempt === 1 ||
            source.kind === "color" ||
            record.job.kind === "generation-alternative"
          )
            throw error;
          record.attempt = 1;
          record.gateFailure =
            error instanceof Error ? error.message : String(error);
          save(record.job.projectId);
        }
      }
    } catch (error) {
      if (shutdown.signal.aborted || removed.has(record.job.projectId)) return;
      if (
        publishFirstAttempt({
          record,
          signal,
          reason: error instanceof Error ? error.message : String(error),
        })
      )
        return;
      const reason = signal.aborted ? signal.reason : error;
      const text = reason instanceof Error ? reason.message : String(reason);
      finish({
        record: record,
        block: { kind: "notice", text, detail: { kind: "error" } },
        failed: true,
      });
      update({ record: record, patch: { stage: "failed", error: text } });
    }
  }
  function pump() {
    if (shutdown.signal.aborted) return;
    const activeCounts = { generation: 0, "generation-alternative": 0 };
    for (const record of records)
      if (Object.hasOwn(running, record.job.id))
        activeCounts[record.job.kind] += 1;
    for (const record of records) {
      if (activeCounts[record.job.kind] >= 2) continue;
      if (
        record.held ||
        removed.has(record.job.projectId) ||
        Object.hasOwn(running, record.job.id) ||
        !["queued", "generating"].includes(record.job.stage)
      )
        continue;
      update({ record, patch: { stage: "generating", error: undefined } });
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, shutdown.signal]);
      const promise = Promise.resolve()
        .then(() => execute(record, signal))
        .catch((error: unknown) => options.logger.error(String(error)))
        .finally(() => {
          delete running[record.job.id];
          pump();
        });
      running[record.job.id] = { controller, promise };
      activeCounts[record.job.kind] += 1;
    }
  }
  function adopt(projectId: string) {
    try {
      for (const record of readInventoryGenerations({
        folder: options.store.projectPath(projectId),
        projectId,
      })) {
        if (records.some((existing) => existing.job.id === record.job.id))
          continue;
        records.push(record);
      }
      save(projectId);
      pump();
    } catch (error) {
      options.logger.error(`Could not adopt generation jobs: ${String(error)}`);
    }
  }
  function add(record: GenerationRecord) {
    records.push(record);
    save(record.job.projectId);
    try {
      options.store.applyCommand({
        projectId: record.job.projectId,
        requestId: undefined,
        command: { type: "item.add", item: record.item },
      });
    } catch (error) {
      records.splice(records.indexOf(record), 1);
      save(record.job.projectId);
      throw error;
    }
    try {
      options.store.flush();
    } catch (error) {
      update({ record, patch: { stage: "failed", error: String(error) } });
      throw error;
    }
    options.bus.publish({ kind: "job.updated", job: record.job });
    pump();
    return { jobId: record.job.id, itemId: record.job.itemId };
  }
  function newRecord(input: {
    projectId: string;
    name: string;
    sizeM: Item["sizeM"];
    placement: Item["placement"];
    mirrored?: boolean;
    cutsOpening?: boolean;
    light?: Item["light"];
    source: GenerationRecord["source"];
    prompt: string;
  }): GenerationRecord {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const itemId = randomUUID();
    return {
      job: {
        id: jobId,
        kind: "generation",
        projectId: input.projectId,
        itemId,
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      item: {
        id: itemId,
        name: input.name,
        sizeM: input.sizeM,
        placement: input.placement,
        ...(input.mirrored === undefined ? {} : { mirrored: input.mirrored }),
        ...(input.cutsOpening === undefined
          ? {}
          : { cutsOpening: input.cutsOpening }),
        ...(input.light === undefined ? {} : { light: input.light }),
        locked: false,
        model: { kind: "pending", jobId },
      },
      source: input.source,
      prompt: input.prompt,
      held: false,
      attempt: 0,
      assetId: randomUUID(),
    };
  }
  function requireAcceptedPhotos(input: {
    projectId: string;
    photoIds: string[];
  }) {
    if (input.photoIds.length === 0) return;
    const accepted = readPhotos(
      options.store.projectPath(input.projectId),
    ).flatMap((photo) => (photo.kind === "accepted" ? [photo.photoId] : []));
    const missing = input.photoIds.find(
      (photoId) => !accepted.includes(photoId),
    );
    if (missing)
      throw new Error(`Photo is not available in this project: ${missing}`);
  }
  function start(input: {
    projectId: string;
    itemId: string;
    notes?: string | undefined;
  }) {
    adopt(input.projectId);
    const current = options.store
      .loadProject(input.projectId)
      .scene.items.find((item) => item.id === input.itemId);
    const record = records.findLast(
      (record) =>
        record.job.projectId === input.projectId &&
        record.job.itemId === input.itemId &&
        record.job.kind === "generation" &&
        !record.job.superseded &&
        ((record.regeneration &&
          current &&
          ["held", "failed", "queued", "generating"].includes(
            record.job.stage,
          ) &&
          (ownsItem({ record, current }) ||
            (current.model.kind === "asset" &&
              record.prepared?.id === current.model.assetId))) ||
          (current?.model.kind === "pending"
            ? record.job.id === current.model.jobId
            : current?.model.kind === "asset" &&
              record.job.stage === "failed" &&
              record.prepared?.id === current.model.assetId)),
    );
    if (current?.model.kind !== "pending" && !record)
      throw new Error("Model this requires a pending item");
    if (!record)
      throw new Error(
        "Generation source is unavailable; attach a photo to create a replacement",
      );
    const jobId = record.job.id;
    if (Object.hasOwn(running, record.job.id) && record.job.stage !== "failed")
      return { jobId };
    if (input.notes !== undefined) record.notes = input.notes;
    record.held = false;
    record.attempt = 0;
    record.gateFailure = undefined;
    if (!record.prepared) record.sizeMismatches = undefined;
    record.firstAttempt = undefined;
    rmSync(firstAttemptFolder(record), { recursive: true, force: true });
    record.job = {
      ...record.job,
      stage: "queued",
      progress: 0,
      error: undefined,
    };
    save(input.projectId);
    options.bus.publish({ kind: "job.updated", job: record.job });
    pump();
    return { jobId };
  }
  return {
    adopt,
    cancel(input: { projectId: string; jobId: string }) {
      const record = records.find(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.id === input.jobId,
      );
      if (!record) throw new Error("Unknown job in this project");
      if (
        record.job.stage !== "queued" ||
        Object.hasOwn(running, record.job.id)
      )
        throw new Error(
          "Only queued jobs can be cancelled; this job has already started or finished",
        );
      if (record.job.kind === "generation") {
        requireCurrentItem(record);
        record.held = true;
        record.job = {
          ...record.job,
          stage: "held",
          updatedAt: new Date().toISOString(),
        };
      } else {
        record.job = {
          ...record.job,
          stage: "cancelled",
          updatedAt: new Date().toISOString(),
        };
      }
      save(input.projectId);
      options.bus.publish({ kind: "job.updated", job: record.job });
      return { jobId: record.job.id, stage: record.job.stage };
    },
    list: () =>
      records
        .filter((record) => !removed.has(record.job.projectId))
        .map((record) => record.job),
    async resume() {
      await stopOrphanWorker(processPath);
      await stopAlternativeWorkers(options.plannerHome);
      for (const project of options.store.listProjects()) {
        const saved = readProjectJobRecords(
          options.store.projectPath(project.id),
        )
          .filter((record) =>
            ["generation", "generation-alternative"].includes(record.job.kind),
          )
          .map((record) => GenerationRecordSchema.parse(record));
        if (saved.some((record) => record.job.projectId !== project.id))
          throw new Error("Generation job belongs to another project");
        for (const record of saved) {
          if (
            record.job.lastLogLine &&
            (/\bRESULT\s*\{/.test(record.job.lastLogLine) ||
              /[\r\n]/.test(record.job.lastLogLine))
          ) {
            mkdirSync(folder(record), { recursive: true });
            log({ record, line: record.job.lastLogLine });
            record.job = { ...record.job, lastLogLine: record.job.stage };
          }
          if (record.prepared && record.job.stage === "failed" && !record.held)
            record.job = { ...record.job, stage: "queued", error: undefined };
        }
        records.push(...saved);
        adopt(project.id);
      }
      pump();
    },
    start,
    regenerate(input: {
      projectId: string;
      itemId: string;
      notes?: string | undefined;
      photoIds?: string[] | undefined;
      primaryPhotoId?: string | undefined;
    }) {
      adopt(input.projectId);
      const current = options.store
        .loadProject(input.projectId)
        .scene.items.find((item) => item.id === input.itemId);
      if (!current) throw new Error("Unknown item");
      const photoIds = input.photoIds ?? [];
      const isAddingPhotos =
        photoIds.length > 0 || input.primaryPhotoId !== undefined;
      requireAcceptedPhotos({
        projectId: input.projectId,
        photoIds: [
          ...photoIds,
          ...(input.primaryPhotoId === undefined ? [] : [input.primaryPhotoId]),
        ],
      });
      function withPhotos(source: GenerationRecord["source"]) {
        return isAddingPhotos
          ? mergeSourcePhotos({
              source,
              photoIds,
              primaryPhotoId: input.primaryPhotoId,
            })
          : source;
      }
      const active = records.findLast(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.itemId === input.itemId &&
          record.job.kind === "generation" &&
          ["queued", "generating"].includes(record.job.stage),
      );
      if (active) {
        if (
          active.regeneration &&
          (active.notes ?? "") === (input.notes ?? "") &&
          isDeepStrictEqual(
            getSourcePhotoIds(withPhotos(active.source)),
            getSourcePhotoIds(active.source),
          )
        )
          return { jobId: active.job.id };
        throw new Error("This item already has an active generation job");
      }
      const previous = records.findLast(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.kind === "generation" &&
          record.job.itemId === current.id,
      );
      if (
        previous?.job.stage === "held" &&
        ownsItem({ record: previous, current })
      ) {
        previous.source = withPhotos(previous.source);
        return start({
          projectId: input.projectId,
          itemId: input.itemId,
          notes: input.notes ?? "",
        });
      }
      if (current.model.kind === "pending" && previous?.job.stage !== "failed")
        throw new Error(
          "Regenerate requires a finished model or a failed item",
        );
      const source = readRegenerationSource({
        projectFolder: options.store.projectPath(input.projectId),
        item: current,
        previous,
        records,
        isAlternative: records.some(
          (record) =>
            record.job.kind === "generation-alternative" &&
            current.model.kind === "asset" &&
            record.assetId === current.model.assetId,
        ),
      });
      const record = newRecord({
        projectId: input.projectId,
        name: current.name,
        sizeM: current.sizeM,
        placement: current.placement,
        source: withPhotos(source.source),
        prompt: source.prompt,
      });
      record.job = { ...record.job, itemId: current.id };
      record.item = current;
      record.notes = input.notes;
      record.colorNotes = source.colorNotes;
      record.regeneration = { sourcePath: source.sourcePath };
      records.push(record);
      save(input.projectId);
      options.bus.publish({ kind: "job.updated", job: record.job });
      pump();
      return { jobId: record.job.id };
    },
    generate(input: { projectId: string; spec: GenerationSpec }) {
      options.store.loadProject(input.projectId);
      const reference = input.spec.reference;
      if (reference.kind === "photo")
        requireAcceptedPhotos({
          projectId: input.projectId,
          photoIds: reference.extraPhotoIds ?? [],
        });
      const { cutsOpening, ...spec } = input.spec;
      const record = newRecord({
        projectId: input.projectId,
        ...spec,
        ...(cutsOpening === undefined ? {} : { cutsOpening }),
        source: input.spec.reference,
      });
      return add(record);
    },
    variant(input: { projectId: string; spec: VariantSpec }) {
      const parent = options.store
        .loadProject(input.projectId)
        .scene.items.find((item) => item.id === input.spec.itemId);
      if (parent?.model.kind !== "asset")
        throw new Error("Variants require a finished asset");
      const parentAssetId = parent.model.assetId;
      const meta = AssetMetaSchema.parse(
        JSON.parse(
          readFileSync(
            jobFilePath({
              folder: options.store.projectPath(input.projectId),
              path: join("assets", parentAssetId, "meta.json"),
            }),
            "utf8",
          ),
        ),
      );
      const change = input.spec.change;
      return add(
        newRecord({
          projectId: input.projectId,
          name: input.spec.name,
          placement: parent.placement,
          ...(parent.mirrored === undefined
            ? {}
            : { mirrored: parent.mirrored }),
          ...(parent.cutsOpening === undefined
            ? {}
            : { cutsOpening: parent.cutsOpening }),
          ...(parent.light === undefined ? {} : { light: parent.light }),
          sizeM: change.kind === "shape" ? change.sizeM : parent.sizeM,
          source:
            change.kind === "shape"
              ? { kind: "shape", parentAssetId }
              : {
                  ...change,
                  parentAssetId,
                  referenceLuma: meta.referenceLuma ?? 0.5,
                  nativeSizeM: meta.nativeSizeM,
                },
          prompt:
            change.kind === "shape"
              ? change.prompt
              : `Color variant ${change.color}`,
        }),
      );
    },
    alternatives(input: {
      projectId: string;
      itemId: string;
      method?: "trellis2" | "sam3d" | undefined;
    }) {
      const current = options.store
        .loadProject(input.projectId)
        .scene.items.find((item) => item.id === input.itemId);
      if (!current) throw new Error("Unknown item");
      const previous = records.findLast(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.itemId === input.itemId &&
          record.source.kind !== "color",
      );
      const source =
        previous?.source ??
        (current.model.kind === "asset"
          ? ({
              kind: "shape",
              parentAssetId: current.model.assetId,
            } satisfies GenerationRecord["source"])
          : undefined);
      if (!source) throw new Error("No reference photo for alternatives");
      const jobIds = (
        input.method
          ? [input.method]
          : (["trellis2", "sam3d"] satisfies ("trellis2" | "sam3d")[])
      ).map((method) => {
        const existing = records.find(
          (record) =>
            record.job.kind === "generation-alternative" &&
            record.job.method === method &&
            record.job.projectId === input.projectId &&
            record.job.itemId === input.itemId &&
            ["queued", "generating"].includes(record.job.stage),
        );
        if (existing) return existing.job.id;
        const record = newRecord({
          projectId: input.projectId,
          name: current.name,
          sizeM: current.sizeM,
          placement: current.placement,
          source,
          prompt: `Alternative ${method}`,
        });
        record.job = {
          ...record.job,
          kind: "generation-alternative",
          stage: "queued",
          method,
          itemId: current.id,
        };
        record.item = current;
        records.push(record);
        save(input.projectId);
        options.bus.publish({ kind: "job.updated", job: record.job });
        return record.job.id;
      });
      pump();
      return { jobIds };
    },
    async modeler(input: {
      projectId: string;
      turnId: string;
      operation: ModelerOperation;
    }) {
      const turn = turns[input.turnId];
      if (
        !turn ||
        turn.record.job.projectId !== input.projectId ||
        turn.signal.aborted
      )
        throw new Error("This modeler turn is not running");
      requireCurrentItem(turn.record);
      if (turn.busy) throw new Error("Wait for the current modeler operation");
      turn.busy = true;
      try {
        const operation = input.operation;
        switch (operation.kind) {
          case "read": {
            const path = jobFilePath({
              folder: turn.folder,
              path: operation.path,
            });
            if (statSync(path).size > 20_000_000)
              throw new Error("File is too large to read");
            if (/\.(png|jpe?g)$/i.test(path))
              return {
                kind: "image",
                data: (
                  await sharp(path)
                    .resize({
                      width: 1568,
                      height: 1568,
                      fit: "inside",
                      withoutEnlargement: true,
                    })
                    .jpeg()
                    .toBuffer()
                ).toString("base64"),
                mimeType: "image/jpeg",
              };
            return { text: readFileSync(path, "utf8") };
          }
          case "write":
            writeFileSync(
              jobFilePath({
                folder: turn.folder,
                path: operation.path,
                writable: true,
              }),
              operation.text,
            );
            return { written: true };
          case "blender": {
            const script = jobFilePath({
              folder: turn.folder,
              path: operation.path,
            });
            if (!script.endsWith(".py"))
              throw new Error("Expected a Python script");
            const result = await blenderRun({
              record: turn.record,
              signal: turn.signal,
              blender: turn.blender,
              script,
              args: ["--job", join(turn.folder, "job.json")],
            });
            return { code: result.code, output: result.output.slice(-8000) };
          }
          case "preview": {
            const input = jobFilePath({ folder: turn.folder, path: "raw.glb" });
            const output = join(turn.folder, "preview.png");
            const preview =
              options.env.ROOMKIT_DESKTOP === "1"
                ? await blenderRun({
                    record: turn.record,
                    signal: turn.signal,
                    blender: turn.blender,
                    script: join(blenderDir, "thumbnail.py"),
                    args: [
                      "--input",
                      input,
                      "--output",
                      output,
                      "--size",
                      "900",
                      "--azimuth",
                      String(operation.azimuthDeg),
                      "--elevation",
                      String(operation.elevationDeg),
                      ...(operation.environment ? ["--environment"] : []),
                    ],
                  })
                : await processRun({
                    record: turn.record,
                    signal: turn.signal,
                    command: process.execPath,
                    cwd: repo,
                    args: [
                      join(repo, "scripts", "b10", "preview.ts"),
                      input,
                      output,
                      turn.record.item.placement.kind,
                      String(operation.azimuthDeg),
                      String(operation.elevationDeg),
                      String(operation.environment ?? false),
                    ],
                  });
            if (preview.code !== 0)
              throw new Error(
                `Preview failed (${preview.code}); see the job log`,
              );
            return {
              kind: "image",
              data: readFileSync(output).toString("base64"),
              mimeType: "image/png",
            };
          }
          case "submit": {
            for (const path of ["raw.glb", "model.py", "notes.md"])
              if (
                !statSync(jobFilePath({ folder: turn.folder, path })).isFile()
              )
                throw new Error(`Missing ${path}`);
            turn.submitted = true;
            return { submitted: true };
          }
          default: {
            const exhaustive: never = operation;
            return exhaustive;
          }
        }
      } finally {
        turn.busy = false;
      }
    },
    itemChanged(projectId: string) {
      for (const record of records.filter(
        (record) =>
          record.job.projectId === projectId &&
          (["queued", "generating"].includes(record.job.stage) ||
            (record.regeneration &&
              ["held", "failed"].includes(record.job.stage) &&
              !record.job.superseded)),
      )) {
        const current = item(record);
        const publication = record.regeneration?.publication;
        if (
          publication?.kind === "applied" &&
          options.store.loadProject(projectId).revision >= publication.revision
        )
          continue;
        if (
          record.prepared &&
          current?.model.kind === "asset" &&
          current.model.assetId === record.assetId
        )
          continue;
        if (!current || !ownsItem({ record, current })) {
          running[record.job.id]?.controller.abort(
            new Error("Item removed or replaced; generation cancelled"),
          );
          record.held = true;
          update({
            record: record,
            patch: {
              stage: "failed",
              error: "Item removed or replaced; generation cancelled",
              superseded: true,
            },
          });
        }
      }
    },
    remove(projectId: string) {
      removed.add(projectId);
      for (const record of records.filter(
        (record) => record.job.projectId === projectId,
      ))
        running[record.job.id]?.controller.abort();
    },
    async stopAll() {
      shutdown.abort();
      await Promise.all(Object.values(running).map((run) => run.promise));
    },
  };
}

function formatMismatches(mismatches: SizeMismatch[]) {
  return mismatches
    .map(
      (mismatch) =>
        `${mismatch.axis} ${mismatch.actualM.toFixed(2)} m vs estimate ${mismatch.expectedM.toFixed(2)} m`,
    )
    .join("; ");
}
