import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { getDefaultLight } from "@planner/shared/src/scene/get-default-light.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import WebSocket from "ws";
import { z } from "zod";
import { createDaemon } from "../packages/daemon/src/create-daemon.ts";

const sourceArg = process.argv.at(2);
if (!sourceArg)
  throw new Error("Usage: node scripts/a22-real-bulb.ts <project-folder>");
const source = resolve(sourceArg);
const lampPatterns = [/mushroom/i, /floor lamp/i];
const webOrigin = "http://127.0.0.1:9";
const root = mkdtempSync(join(tmpdir(), "a22-real-bulb-"));
const project = ProjectSchema.parse(
  JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
);
const copy = join(root, "projects", project.id);
mkdirSync(join(copy, ".planner"), { recursive: true });
mkdirSync(join(copy, "photos"), { recursive: true });
cpSync(join(source, "project.json"), join(copy, "project.json"));
cpSync(join(source, "assets"), join(copy, "assets"), { recursive: true });
cpSync(
  join(source, "photos", "photos.json"),
  join(copy, "photos", "photos.json"),
);
const daemon = createDaemon({
  env: {
    ...process.env,
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
    PLANNER_PORT: "0",
    PLANNER_WEB_ORIGIN: webOrigin,
  },
});
const address = await daemon.listen();
const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
  origin: webOrigin,
});
const listeners = new Set<(value: unknown) => void>();
socket.on("message", (data) => {
  const value: unknown = JSON.parse(data.toString());
  for (const listener of listeners) listener(value);
});
await new Promise((settle) => socket.once("open", settle));
function command(body: { type: string; [key: string]: unknown }) {
  const requestId = crypto.randomUUID();
  return new Promise<unknown>((settle, reject) => {
    function listen(value: unknown) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("requestId" in value) ||
        value.requestId !== requestId
      )
        return;
      listeners.delete(listen);
      if ("ok" in value && value.ok)
        settle("result" in value ? value.result : undefined);
      else reject(new Error(JSON.stringify(value)));
    }
    listeners.add(listen);
    socket.send(JSON.stringify({ ...body, requestId }));
  });
}
const FinishedJobSchema = z.object({
  event: z.object({
    job: z.object({
      id: z.string(),
      stage: z.enum(["done", "failed", "cancelled"]),
      lastLogLine: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
});
function waitForJob(jobId: string) {
  return new Promise<z.infer<typeof FinishedJobSchema>["event"]["job"]>(
    (settle) => {
      function listen(value: unknown) {
        const job = FinishedJobSchema.safeParse(value).data?.event.job;
        if (job?.id !== jobId) return;
        listeners.delete(listen);
        settle(job);
      }
      listeners.add(listen);
    },
  );
}
const report: { [name: string]: unknown } = {};
try {
  await command({ type: "project.open", projectId: project.id });
  for (const pattern of lampPatterns) {
    const item = daemon.store
      .loadProject(project.id)
      .scene.items.find((candidate) => pattern.test(candidate.name));
    if (!item) throw new Error(`No item matches ${pattern}`);
    const before: Item["light"] = item.light ?? getDefaultLight(item.placement);
    if (!item.light)
      await command({
        type: "scene.apply",
        projectId: project.id,
        command: {
          type: "item.update",
          itemId: item.id,
          patch: { light: before },
        },
      });
    const started = Date.now();
    const { jobId } = z.object({ jobId: z.string() }).parse(
      await command({
        type: "bulb.find",
        projectId: project.id,
        itemId: item.id,
      }),
    );
    const job = await waitForJob(jobId);
    const after = daemon.store
      .loadProject(project.id)
      .scene.items.find((candidate) => candidate.id === item.id)?.light;
    report[item.name] = {
      itemId: item.id,
      job,
      seconds: Math.round((Date.now() - started) / 1000),
      before,
      after,
      views: join(copy, ".planner", "bulbs", jobId),
    };
    console.log(JSON.stringify({ [item.name]: report[item.name] }, null, 2));
  }
  daemon.store.flush();
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Project copy: ${copy}`);
} finally {
  socket.close();
  await daemon.close();
}
