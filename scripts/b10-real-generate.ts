import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { readInventoryGenerations } from "../packages/daemon/src/generation/read-inventory-generations.ts";
import { stopOrphanWorker } from "../packages/daemon/src/python/stop-orphan-worker.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const sourceFolder = process.argv.at(2);
if (!sourceFolder)
  throw new Error(
    "Usage: node scripts/b10-real-generate.ts <completed-inventory-project-folder>",
  );
const sourceProject = ProjectSchema.parse(
  JSON.parse(readFileSync(join(sourceFolder, "project.json"), "utf8")),
);
const source = readInventoryGenerations({
  folder: sourceFolder,
  projectId: sourceProject.id,
}).find((record) => /sofa/i.test(record.item.name));
assert.ok(
  source && source.source.kind === "inventory",
  "The source project needs an inventoried sofa and its crop masks",
);
const fixture = await createReconFixture({
  real: true,
  keep: true,
  env: {
    ...process.env,
    HOME: process.env.HOME,
    PLANNER_CLAUDE_BIN: process.env.PLANNER_CLAUDE_BIN ?? "claude",
    PLANNER_CODEX_BIN: process.env.PLANNER_CODEX_BIN ?? "codex",
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
  },
});
let daemon: Awaited<ReturnType<typeof fixture.start>> | undefined;
try {
  daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "B10 real sofa",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      modeler: {
        cli: process.env.PLANNER_B10_CLI === "codex" ? "codex" : "claude",
        model: process.env.PLANNER_B10_MODEL ?? config.roles.modeler.model,
      },
    },
  });
  await daemon.stop();
  daemon = undefined;
  const folder = join(fixture.root, "projects", project.id);
  cpSync(join(sourceFolder, "photos"), join(folder, "photos"), {
    recursive: true,
    dereference: false,
  });
  const inventory = join(".planner", "inventory", source.source.inventoryJobId);
  cpSync(join(sourceFolder, inventory), join(folder, inventory), {
    recursive: true,
    dereference: false,
  });
  const record = GenerationRecordSchema.parse({
    ...source,
    job: {
      ...source.job,
      projectId: project.id,
      stage: "queued",
      progress: 0,
      error: undefined,
    },
    held: false,
    attempt: 0,
    prepared: undefined,
  });
  writeJson({
    path: join(folder, "project.json"),
    value: {
      ...project,
      scene: { ...sourceProject.scene, items: [record.item] },
    },
  });
  writeJson({ path: join(folder, ".planner", "jobs.json"), value: [record] });
  daemon = await fixture.start();
  daemon.socket.on("message", (bytes) => {
    const frame = JSON.parse(bytes.toString());
    if (frame.type === "event" && frame.event.kind === "job.updated")
      process.stdout.write(
        `${frame.event.job.stage}: ${frame.event.job.lastLogLine ?? ""}\n`,
      );
  });
  const current = daemon;
  const result = await current.waitFor({
    label: "real sofa generation",
    timeoutMs: 3600000,
    read: () =>
      current.frames
        .flatMap((frame) =>
          frame.type === "event" && frame.event.kind === "job.updated"
            ? [frame.event.job]
            : [],
        )
        .findLast(
          (job) =>
            job.id === record.job.id && ["ready", "failed"].includes(job.stage),
        ),
  });
  assert.equal(result.stage, "ready", result.error);
  const imagePath = join(fixture.root, "sofa.png");
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve("scripts/b10/preview.ts"),
        join(folder, "assets", record.assetId, "model.glb"),
        imagePath,
        "floor",
        "30",
        "20",
        "true",
      ],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", done);
  });
  assert.equal(code, 0);
  process.stdout.write(
    `Real sofa passed the generation gate. Screenshot: ${imagePath}\n`,
  );
} finally {
  await daemon?.stop();
  await stopOrphanWorker(join(fixture.root, "home", "generation-worker.json"));
  await fixture.close();
  process.stdout.write(`Evidence retained at ${fixture.root}\n`);
}
