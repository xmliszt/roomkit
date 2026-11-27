import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  type RenderJob,
  RenderJobSchema,
} from "@planner/shared/src/jobs/job-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import sharp from "sharp";
import type { ChatStore } from "../chat/create-chat-store.ts";
import { createJobOutputLog } from "../jobs/create-job-output-log.ts";
import { checkBlender } from "../preflight/check-blender.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { exportRenderScene } from "./export-render-scene.ts";
import { runPhotoRender } from "./run-photo-render.ts";

export function createRenderQueue(options: {
  store: ProjectStore;
  chat: ChatStore;
  bus: EventBus;
  env: NodeJS.ProcessEnv;
  blenderPaths: () => string[];
}) {
  type Record = {
    job: RenderJob;
    folder: string;
    controller: AbortController;
    running?: Promise<void> | undefined;
  };
  const records: { [id: string]: Record } = Object.create(null);
  const removed = new Set<string>();
  const appendLog = createJobOutputLog(options);
  function update(record: (typeof records)[string], patch: Partial<RenderJob>) {
    if (removed.has(record.job.projectId)) return;
    record.job = RenderJobSchema.parse({
      ...record.job,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    writeJson({ path: join(record.folder, "job.json"), value: record.job });
    options.bus.publish({ kind: "job.updated", job: record.job });
  }
  async function run(record: (typeof records)[string]) {
    try {
      const blender = await checkBlender({
        candidates: options.blenderPaths(),
        env: options.env,
      });
      record.controller.signal.throwIfAborted();
      if (blender.state !== "present")
        throw new Error(
          "Blender is missing or cannot start. Check Blender in Settings.",
        );
      update(record, { waitingFor: "machine" });
      let lastPublishedMs = 0;
      await runPhotoRender({
        blender: blender.path,
        folder: record.folder,
        env: options.env,
        signal: record.controller.signal,
        onAcquired() {
          update(record, {
            stage: "exporting",
            waitingFor: undefined,
            startedAt: new Date().toISOString(),
          });
        },
        onLine(line) {
          if (removed.has(record.job.projectId)) return;
          appendLog({
            jobId: record.job.id,
            path: join(record.folder, "worker.log"),
            line,
          });
          record.job = { ...record.job, lastLogLine: line.slice(-1000) };
        },
        onSamples(progress) {
          if (Date.now() - lastPublishedMs < 250) return;
          lastPublishedMs = Date.now();
          update(record, { stage: "rendering", progress });
        },
      });
      record.controller.signal.throwIfAborted();
      const png = join(record.folder, "render.png");
      const bytes = readFileSync(png);
      const metadata = await sharp(bytes).metadata();
      if (metadata.format !== "png" || !metadata.width || !metadata.height)
        throw new Error("Blender did not produce a PNG image");
      record.controller.signal.throwIfAborted();
      const projectFolder = options.store.projectPath(record.job.projectId);
      mkdirSync(join(projectFolder, "renders"), { recursive: true });
      renameSync(png, join(projectFolder, "renders", `${record.job.id}.png`));
      options.chat.appendBlock({
        projectId: record.job.projectId,
        messageId: record.job.id,
        block: {
          kind: "render",
          jobId: record.job.id,
          fileName: `${record.job.id}.png`,
          sizeBytes: bytes.length,
          widthPx: metadata.width,
          heightPx: metadata.height,
        },
      });
      options.chat.finish({
        projectId: record.job.projectId,
        messageId: record.job.id,
        status: "done",
      });
      update(record, {
        stage: "done",
        progress: 1,
        waitingFor: undefined,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const isCancelled = record.controller.signal.aborted;
      const text = isCancelled
        ? "Render cancelled"
        : error instanceof Error
          ? error.message
          : String(error);
      update(record, {
        stage: isCancelled ? "cancelled" : "failed",
        error: text,
        waitingFor: undefined,
        finishedAt: new Date().toISOString(),
      });
      if (!removed.has(record.job.projectId)) {
        options.chat.appendBlock({
          projectId: record.job.projectId,
          messageId: record.job.id,
          block: { kind: "notice", text, detail: { kind: "error" } },
        });
        options.chat.finish({
          projectId: record.job.projectId,
          messageId: record.job.id,
          status: isCancelled ? "stopped" : "failed",
        });
      }
    }
  }
  return {
    list: () =>
      Object.values(records)
        .filter((record) => !removed.has(record.job.projectId))
        .map((record) => record.job),
    start(input: { projectId: string; view: RenderView }) {
      const project = options.store.loadProject(input.projectId);
      const id = randomUUID();
      const folder = join(
        options.store.projectPath(input.projectId),
        ".planner/render",
        id,
      );
      try {
        exportRenderScene({
          project,
          view: input.view,
          projectFolder: options.store.projectPath(input.projectId),
          folder,
        });
      } catch (error) {
        rmSync(folder, { recursive: true, force: true });
        throw error;
      }
      const now = new Date().toISOString();
      const record: Record = {
        job: RenderJobSchema.parse({
          id,
          kind: "render",
          projectId: input.projectId,
          stage: "queued",
          progress: 0,
          createdAt: now,
          updatedAt: now,
        }),
        folder,
        controller: new AbortController(),
      };
      records[id] = record;
      options.chat.add({
        projectId: input.projectId,
        message: {
          id,
          author: { kind: "agent", role: "designer" },
          blocks: [{ kind: "job", jobId: id }],
          status: "streaming",
          createdAt: now,
        },
      });
      update(record, {});
      record.running = run(record);
      return { jobId: id };
    },
    async cancel(input: { projectId: string; jobId: string }) {
      const record = Object.hasOwn(records, input.jobId)
        ? records[input.jobId]
        : undefined;
      if (!record || record.job.projectId !== input.projectId)
        throw new Error("Unknown render in this project");
      if (!["queued", "exporting", "rendering"].includes(record.job.stage))
        throw new Error("This render has already finished");
      record.controller.abort();
      await record.running;
      return { jobId: input.jobId, stage: "cancelled" as const };
    },
    remove(projectId: string) {
      removed.add(projectId);
      for (const record of Object.values(records).filter(
        (entry) => entry.job.projectId === projectId,
      ))
        record.controller.abort();
    },
    async resume() {
      for (const project of options.store.listProjects()) {
        const root = join(
          options.store.projectPath(project.id),
          ".planner/render",
        );
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const folder = join(root, entry.name);
          if (!existsSync(join(folder, "job.json"))) continue;
          const job = RenderJobSchema.parse(
            JSON.parse(readFileSync(join(folder, "job.json"), "utf8")),
          );
          if (job.projectId !== project.id || job.id !== entry.name)
            throw new Error("Invalid saved render job");
          await stopOrphanWorker(join(folder, "process.json"));
          const record = { job, folder, controller: new AbortController() };
          records[job.id] = record;
          if (["queued", "exporting", "rendering"].includes(job.stage)) {
            update(record, {
              stage: "failed",
              waitingFor: undefined,
              error:
                "The app stopped before this render finished. Render the view again.",
              finishedAt: new Date().toISOString(),
            });
            options.chat.finish({
              projectId: job.projectId,
              messageId: job.id,
              status: "failed",
            });
          }
        }
      }
    },
    async stopAll() {
      for (const record of Object.values(records)) record.controller.abort();
      await Promise.all(Object.values(records).map((record) => record.running));
    },
  };
}
