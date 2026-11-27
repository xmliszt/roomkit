import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
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
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { ModelerOperation } from "@planner/shared/src/generation/modeler-operation-schema.ts";
import type { SurfaceJob } from "@planner/shared/src/jobs/job-schema.ts";
import { SurfaceAssetMetaSchema } from "@planner/shared/src/scene/surface-asset-meta-schema.ts";
import type { SurfaceTarget } from "@planner/shared/src/scene/surface-target-schema.ts";
import sharp from "sharp";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { ChatStore } from "../chat/create-chat-store.ts";
import type { createTurnSlots } from "../chat/create-turn-slots.ts";
import { describeSceneChanges } from "../chat/describe-scene-changes.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { runGenerationProcess } from "../generation/run-generation-process.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { buildMissingRequirementNotice } from "../preflight/build-missing-requirement-notice.ts";
import { checkBlender } from "../preflight/check-blender.ts";
import { resolveToolPaths } from "../preflight/resolve-tool-paths.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";
import { JobRecordSchema } from "../reconstruction/job-record-schema.ts";
import type { Logger } from "../util/logger.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { checkSurfaceTextures } from "./check-surface-textures.ts";
import { prepareSurfaceFolder } from "./prepare-surface-folder.ts";
import {
  type SurfaceRecord,
  SurfaceRecordSchema,
} from "./surface-record-schema.ts";

export function createSurfaceQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  logger: Logger;
  runtime: ReturnType<typeof createAgentRuntime>;
  config: () => Config;
  env: NodeJS.ProcessEnv;
  plannerHome: string;
  agentSlots: ReturnType<typeof createTurnSlots>;
  workerSlots: ReturnType<typeof createTurnSlots>;
  link: () => { wsUrl: string; token: string };
}) {
  const records: SurfaceRecord[] = [];
  const appendLog = createJobOutputLog({ bus: options.bus, env: options.env });
  const running: {
    [id: string]: { controller: AbortController; promise: Promise<void> };
  } = Object.create(null);
  const turns: {
    [id: string]: {
      record: SurfaceRecord;
      signal: AbortSignal;
      blender: string;
      submitted: boolean;
      busy: boolean;
    };
  } = Object.create(null);
  const removed = new Set<string>();
  const shutdown = new AbortController();
  const processPath = join(options.plannerHome, "surface-worker.json");
  const lastProgress: { [id: string]: number } = Object.create(null);
  function folder(record: SurfaceRecord) {
    return join(
      options.store.projectPath(record.job.projectId),
      ".planner",
      "surfaces",
      record.job.id,
    );
  }
  function save(projectId: string) {
    if (!removed.has(projectId))
      writeProjectJobRecords({
        folder: options.store.projectPath(projectId),
        kind: "surface",
        records: records.filter((record) => record.job.projectId === projectId),
      });
  }
  function update(input: {
    record: SurfaceRecord;
    patch: Partial<
      Pick<SurfaceJob, "stage" | "progress" | "error" | "lastLogLine">
    >;
  }) {
    const { record, patch } = input;
    if (!patch.stage && Date.now() - (lastProgress[record.job.id] ?? 0) < 250)
      return;
    lastProgress[record.job.id] = Date.now();
    record.job = {
      ...record.job,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    save(record.job.projectId);
    options.bus.publish({ kind: "job.updated", job: record.job });
  }
  function message(record: SurfaceRecord) {
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
  function log(input: { record: SurfaceRecord; line: string }) {
    appendLog({
      jobId: input.record.job.id,
      path: join(folder(input.record), "worker.log"),
      line: input.line,
    });
  }
  function surface(record: SurfaceRecord) {
    const room = options.store.loadProject(record.job.projectId).scene.room;
    return Object.hasOwn(room.surfaces, record.job.surfaceId)
      ? room.surfaces[record.job.surfaceId]
      : undefined;
  }
  function requireUnchanged(record: SurfaceRecord) {
    const room = options.store.loadProject(record.job.projectId).scene.room;
    const original = Object.hasOwn(record.room.surfaces, record.job.surfaceId)
      ? record.room.surfaces[record.job.surfaceId]
      : undefined;
    if (
      !isDeepStrictEqual(room.walls, record.room.walls) ||
      room.ceilingHeightM !== record.room.ceilingHeightM ||
      !isDeepStrictEqual(surface(record), original)
    )
      throw new Error(
        "Room or surface changed while generating; request the surface again",
      );
  }
  function publish(record: SurfaceRecord) {
    if (!record.outcome) throw new Error("Surface has not passed its gate");
    const project = options.store.loadProject(record.job.projectId);
    if (
      record.outcome.kind === "prepared" ||
      project.revision < record.outcome.revision
    ) {
      const command = record.outcome.command;
      if (command.type !== "surface.update")
        throw new Error("Expected a surface update");
      const revision = (() => {
        if (
          isDeepStrictEqual(surface(record), {
            color: command.color,
            material: command.material,
          })
        )
          return project.revision;
        requireUnchanged(record);
        return options.store.applyCommand({
          projectId: record.job.projectId,
          command,
          requestId: undefined,
        }).revision;
      })();
      record.outcome = { ...record.outcome, kind: "applied", revision };
      save(record.job.projectId);
    }
    options.store.flush();
    message(record);
    options.chat.setBlock({
      projectId: record.job.projectId,
      messageId: record.job.id,
      blockIndex: 1,
      block: record.outcome.block,
    });
    options.chat.finish({
      projectId: record.job.projectId,
      messageId: record.job.id,
      status: "done",
    });
    update({
      record,
      patch: { stage: "ready", progress: 1, error: undefined },
    });
  }
  async function prepareOutcome(record: SurfaceRecord) {
    const result = await checkSurfaceTextures({
      folder: folder(record),
      assetId: record.assetId,
    });
    requireUnchanged(record);
    const scene = options.store.loadProject(record.job.projectId).scene;
    const command = {
      type: "surface.update",
      surfaceId: record.job.surfaceId,
      color: result.color,
      material: result.material,
    } satisfies Command;
    const undo = invertCommand({ scene, command });
    const applied = applyCommand({ scene, command });
    if (!undo || applied.kind === "rejected")
      throw new Error("Surface result does not apply to this room");
    const assetRoot = join(
      options.store.projectPath(record.job.projectId),
      "assets",
    );
    const staging = join(assetRoot, `${record.assetId}.part`);
    mkdirSync(staging, { recursive: true });
    for (const file of result.files)
      copyFileSync(
        jobFilePath({ folder: folder(record), path: file }),
        join(staging, file),
      );
    writeJson({
      path: join(staging, "meta.json"),
      value: SurfaceAssetMetaSchema.parse({
        id: record.assetId,
        kind: "surface",
        color: result.color,
        material: result.material,
        provenance: {
          method: "surfacer",
          prompt: record.prompt,
          sourcePhotoIds: record.photoIds,
        },
      }),
    });
    rmSync(join(assetRoot, record.assetId), { recursive: true, force: true });
    renameSync(staging, join(assetRoot, record.assetId));
    const changes = describeSceneChanges({
      before: scene,
      after: applied.scene,
    });
    record.outcome = {
      kind: "prepared",
      command,
      block: changes.length
        ? { kind: "diff", changes, undo: [undo] }
        : {
            kind: "text",
            markdown: "This surface already has the requested finish.",
          },
    };
    save(record.job.projectId);
  }
  async function runTurn(input: {
    record: SurfaceRecord;
    signal: AbortSignal;
    blender: string;
  }) {
    const release = await options.agentSlots.acquire(input.signal);
    if (!release) {
      input.signal.throwIfAborted();
      throw new Error("Agent slot unavailable");
    }
    const turnId = randomUUID();
    const turn = { ...input, submitted: false, busy: false };
    turns[turnId] = turn;
    const dir = join(
      options.store.projectPath(input.record.job.projectId),
      ".planner",
      "sessions",
      `turn-${turnId}`,
    );
    const tools = ROLE_TOOLS.modeler
      .filter((tool) => tool !== "modeler_preview")
      .map((name) => `mcp__planner__${name}`);
    const role = options.config().roles.modeler;
    try {
      input.signal.throwIfAborted();
      update({
        record: input.record,
        patch: { stage: "generating", progress: 0.1, error: undefined },
      });
      const mcpConfigPath = writeMcpConfig({
        projectId: input.record.job.projectId,
        turnId,
        role: "modeler",
        allowedTools: tools,
        ...options.link(),
        dir,
      });
      const result = await options.runtime.runTurn({
        project: options.store.projectPath(input.record.job.projectId),
        cwd: folder(input.record),
        session: {
          id: `modeler-surfacer-${turnId}-1`,
          role: "modeler",
          cli: role.cli,
        },
        model: role.model,
        systemPrompt: readFileSync(
          fileURLToPath(
            new URL("../../../../roles/surfacer.md", import.meta.url),
          ),
          "utf8",
        ),
        prompt: `Build the surface in job.json. ${input.record.prompt}\n${input.record.gateFailure ? `Previous gate failure: ${input.record.gateFailure}` : ""}`,
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
            ? `Surfacer usage limit reached${result.usageLimit.resetsAt ? `; resets at ${result.usageLimit.resetsAt}` : ""}; see the job log`
            : "Surfacer failed; see the job log",
        );
      }
      if (!turn.submitted)
        throw new Error("Surfacer finished without asset_submit");
    } finally {
      delete turns[turnId];
      release();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  async function execute(record: SurfaceRecord, signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      if (record.outcome) {
        publish(record);
        return;
      }
      requireUnchanged(record);
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
      const agentMissing = (() => {
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
        options.chat.setBlock({
          projectId: record.job.projectId,
          messageId: record.job.id,
          blockIndex: 1,
          block: notice,
        });
        throw new Error(notice.text);
      }
      prepareSurfaceFolder({
        record,
        folder: folder(record),
        projectFolder: options.store.projectPath(record.job.projectId),
      });
      while (record.attempt < 2) {
        await runTurn({ record, signal, blender: blender.path });
        signal.throwIfAborted();
        try {
          await prepareOutcome(record);
          break;
        } catch (error) {
          record.attempt += 1;
          record.gateFailure = String(error);
          save(record.job.projectId);
          if (record.attempt >= 2) throw error;
        }
      }
      signal.throwIfAborted();
      publish(record);
    } catch (error) {
      if (
        removed.has(record.job.projectId) ||
        shutdown.signal.aborted ||
        record.job.stage === "cancelled"
      )
        return;
      update({ record, patch: { stage: "failed", error: String(error) } });
      message(record);
      const existing = options.chat
        .list(record.job.projectId)
        .find((message) => message.id === record.job.id)
        ?.blocks.at(1);
      if (existing?.kind !== "notice")
        options.chat.setBlock({
          projectId: record.job.projectId,
          messageId: record.job.id,
          blockIndex: 1,
          block: {
            kind: "notice",
            detail: { kind: "error" },
            text: String(error),
          },
        });
      options.chat.finish({
        projectId: record.job.projectId,
        messageId: record.job.id,
        status: "failed",
      });
    }
  }
  function pump() {
    if (shutdown.signal.aborted) return;
    for (const record of records) {
      if (
        removed.has(record.job.projectId) ||
        running[record.job.id] ||
        !["queued", "generating"].includes(record.job.stage)
      )
        continue;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, shutdown.signal]);
      const promise = execute(record, signal)
        .finally(() => {
          delete running[record.job.id];
          if (!shutdown.signal.aborted && !removed.has(record.job.projectId))
            autoStart(record.job.projectId);
        })
        .catch((error) => options.logger.error(String(error)));
      running[record.job.id] = { controller, promise };
    }
  }
  function enqueue(input: {
    projectId: string;
    surfaceId: string;
    prompt: string;
    reconstructionJobId?: string;
    photoIds?: string[];
  }) {
    const room = options.store.loadProject(input.projectId).scene.room;
    if (
      !["floor", "ceiling"].includes(input.surfaceId) &&
      !room.walls.some(
        (wall) => wall.id === input.surfaceId && wall.kind !== "open",
      )
    )
      throw new Error("Surface does not exist or is an open wall");
    const active = records.find(
      (record) =>
        record.job.projectId === input.projectId &&
        record.job.surfaceId === input.surfaceId &&
        ["queued", "generating"].includes(record.job.stage),
    );
    if (active)
      throw new Error("This surface already has a job; wait for it to finish");
    const now = new Date().toISOString();
    const record: SurfaceRecord = {
      job: {
        id: randomUUID(),
        kind: "surface",
        projectId: input.projectId,
        surfaceId: input.surfaceId,
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      room: structuredClone(room),
      photoIds: readPhotos(options.store.projectPath(input.projectId))
        .filter(
          (photo) =>
            photo.kind === "accepted" &&
            photo.origin === "capture" &&
            (!input.photoIds || input.photoIds.includes(photo.photoId)),
        )
        .map((photo) => photo.photoId),
      prompt: input.prompt,
      assetId: randomUUID(),
      attempt: 0,
      ...(input.reconstructionJobId
        ? { reconstructionJobId: input.reconstructionJobId }
        : {}),
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
  function autoStart(projectId: string) {
    const project = options.store.loadProject(projectId);
    if (!project.reconstruction) return;
    const reconstruction = readProjectJobRecords(
      options.store.projectPath(projectId),
    )
      .filter((record) => record.job.kind === "reconstruction")
      .map((record) => JobRecordSchema.parse(record))
      .find(
        (record) =>
          record.job.id === project.reconstruction?.jobId &&
          record.job.stage === "done",
      );
    if (!reconstruction) return;
    for (const surfaceId of [
      "floor",
      ...project.scene.room.walls
        .filter((wall) => wall.kind !== "open")
        .map((wall) => wall.id),
      "ceiling",
    ]) {
      if (
        records.some(
          (record) =>
            record.job.projectId === projectId &&
            record.job.surfaceId === surfaceId &&
            (record.reconstructionJobId === reconstruction.job.id ||
              ["queued", "generating"].includes(record.job.stage)),
        )
      )
        continue;
      try {
        enqueue({
          projectId,
          surfaceId,
          reconstructionJobId: reconstruction.job.id,
          photoIds: reconstruction.photoIds,
          prompt:
            "Reproduce this surface from the capture photos. Measure its repeat against the room dimensions. Preserve its real colour and finish.",
        });
      } catch (error) {
        options.logger.warn(String(error));
      }
    }
  }
  return {
    list: () =>
      records
        .filter((record) => !removed.has(record.job.projectId))
        .map((record) => record.job),
    start(input: { projectId: string; target: SurfaceTarget; prompt: string }) {
      const room = options.store.loadProject(input.projectId).scene.room;
      const surfaceIds =
        input.target.kind === "surface"
          ? [input.target.surfaceId]
          : room.walls
              .filter((wall) => wall.kind !== "open")
              .map((wall) => wall.id);
      if (!surfaceIds.length)
        throw new Error("There are no closed walls to finish");
      if (
        records.some(
          (record) =>
            record.job.projectId === input.projectId &&
            surfaceIds.includes(record.job.surfaceId) &&
            ["queued", "generating"].includes(record.job.stage),
        )
      )
        throw new Error(
          "A target surface already has a job; wait for it to finish",
        );
      return {
        jobIds: surfaceIds.map(
          (surfaceId) =>
            enqueue({
              projectId: input.projectId,
              surfaceId,
              prompt: input.prompt,
            }).jobId,
        ),
      };
    },
    cancel(input: { projectId: string; jobId: string }) {
      const record = records.find(
        (record) =>
          record.job.projectId === input.projectId &&
          record.job.id === input.jobId,
      );
      if (!record) throw new Error("Unknown job in this project");
      if (record.job.stage !== "queued")
        throw new Error(
          "Only queued jobs can be cancelled; this job has already started or finished",
        );
      update({ record, patch: { stage: "cancelled" } });
      running[record.job.id]?.controller.abort();
      options.chat.finish({
        projectId: record.job.projectId,
        messageId: record.job.id,
        status: "done",
      });
      return { jobId: record.job.id, stage: record.job.stage };
    },
    autoStart,
    ownsTurn: (input: { projectId: string; turnId: string }) =>
      turns[input.turnId]?.record.job.projectId === input.projectId,
    async resume() {
      await stopOrphanWorker(processPath);
      for (const project of options.store.listProjects()) {
        for (const record of readProjectJobRecords(
          options.store.projectPath(project.id),
        ))
          if (record.job.kind === "surface") {
            const parsed = SurfaceRecordSchema.parse(record);
            if (parsed.job.projectId !== project.id)
              throw new Error("Surface job belongs to another project");
            if (
              parsed.job.lastLogLine &&
              (/\bRESULT\s*\{/.test(parsed.job.lastLogLine) ||
                /[\r\n]/.test(parsed.job.lastLogLine))
            ) {
              mkdirSync(folder(parsed), { recursive: true });
              log({ record: parsed, line: parsed.job.lastLogLine });
              parsed.job = { ...parsed.job, lastLogLine: parsed.job.stage };
            }
            if (parsed.outcome && parsed.job.stage === "failed")
              parsed.job = { ...parsed.job, stage: "queued", error: undefined };
            records.push(parsed);
          }
        save(project.id);
      }
      pump();
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
        turn.signal.aborted ||
        turn.submitted
      )
        throw new Error("This surfacer turn is not running");
      requireUnchanged(turn.record);
      if (turn.busy) throw new Error("Wait for the current surfacer operation");
      turn.busy = true;
      const operation = input.operation;
      const root = folder(turn.record);
      try {
        switch (operation.kind) {
          case "read": {
            const path = jobFilePath({ folder: root, path: operation.path });
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
                    .png()
                    .toBuffer()
                ).toString("base64"),
                mimeType: "image/png",
              };
            return { text: readFileSync(path, "utf8") };
          }
          case "write":
            writeFileSync(
              jobFilePath({
                folder: root,
                path: operation.path,
                writable: true,
              }),
              operation.text,
            );
            return { written: true };
          case "blender": {
            const script = jobFilePath({ folder: root, path: operation.path });
            if (!script.endsWith(".py"))
              throw new Error("Expected a Python script");
            const release = await options.workerSlots.acquire(turn.signal);
            if (!release) {
              turn.signal.throwIfAborted();
              throw new Error("Worker slot unavailable");
            }
            try {
              await stopOrphanWorker(processPath);
              const result = await runGenerationProcess({
                command: turn.blender,
                args: [
                  "--background",
                  "--factory-startup",
                  "--python-exit-code",
                  "1",
                  "--python-expr",
                  "import sys; sys.dont_write_bytecode = True",
                  "--python",
                  script,
                  "--",
                  "--job",
                  join(root, "job.json"),
                ],
                cwd: root,
                env: options.env,
                signal: turn.signal,
                processPath,
                timeoutMs: 900000,
                onLine(line) {
                  log({ record: turn.record, line });
                },
              });
              return { code: result.code, output: result.output.slice(-8000) };
            } finally {
              release();
            }
          }
          case "preview":
            throw new Error(
              "Read the PNG textures with modeler_read to compare a surface",
            );
          case "submit":
            for (const path of ["surface.json", "surface.py", "notes.md"])
              if (!statSync(jobFilePath({ folder: root, path })).isFile())
                throw new Error(`Missing ${path}`);
            turn.submitted = true;
            return { submitted: true };
          default: {
            const exhaustive: never = operation;
            return exhaustive;
          }
        }
      } finally {
        turn.busy = false;
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
