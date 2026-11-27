import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { readInventoryGenerations } from "../packages/daemon/src/generation/read-inventory-generations.ts";
import { readProjectJobRecords } from "../packages/daemon/src/jobs/read-project-job-records.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const sourceArg = process.argv.at(2);
const tileSizeM = Number(process.argv.at(3));
if (!sourceArg || !Number.isFinite(tileSizeM) || tileSizeM <= 0)
  throw new Error(
    "Usage: node scripts/b15-real-surfaces.ts <finished-project-folder> <expected-floor-tile-size-m>",
  );
const source = resolve(sourceArg);
const project = ProjectSchema.parse(
  JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
);
assert.ok(
  project.reconstruction,
  "The project must have a finished reconstruction",
);
const saved = readProjectJobRecords(source).filter(
  (record) =>
    record.job.kind === "reconstruction" || record.job.kind === "inventory",
);
assert.ok(
  saved.some(
    (record) =>
      record.job.kind === "reconstruction" &&
      record.job.id === project.reconstruction?.jobId &&
      record.job.stage === "done",
  ),
  "Completed reconstruction record is required",
);
assert.ok(
  saved.some(
    (record) => record.job.kind === "inventory" && record.job.stage === "done",
  ),
  "Use the finished project after inventory completes",
);
assert.ok(
  saved.every(
    (record) => record.job.stage === "done" || record.job.stage === "failed",
  ),
  "Finish active reconstruction and inventory jobs first",
);
const fixture = await createReconFixture({
  real: true,
  keep: true,
  env: {
    ...process.env,
    HOME: process.env.HOME,
    PLANNER_CLAUDE_BIN: process.env.PLANNER_CLAUDE_BIN ?? "claude",
    PLANNER_CODEX_BIN: process.env.PLANNER_CODEX_BIN ?? "codex",
  },
});
const copy = join(fixture.root, "projects", project.id);
cpSync(source, copy, {
  recursive: true,
  filter: (path) => path !== join(source, ".planner", "sessions"),
});
mkdirSync(join(copy, ".planner"), { recursive: true });
writeJson({
  path: join(copy, ".planner", "jobs.json"),
  value: [
    ...saved,
    ...readInventoryGenerations({ folder: copy, projectId: project.id }).map(
      (record) => ({ ...record, held: true }),
    ),
  ],
});
const config = createDefaultConfig();
writeJson({
  path: join(fixture.root, "home", "config.json"),
  value: {
    ...config,
    roles: {
      ...config.roles,
      modeler: {
        cli: process.env.PLANNER_B15_CLI ?? "claude",
        model: process.env.PLANNER_B15_MODEL ?? config.roles.modeler.model,
      },
    },
  },
});
process.stdout.write(`Surface run copy: ${copy}\n`);
const daemon = await fixture.start();
const progress = setInterval(() => {
  const latest = Object.fromEntries(
    daemon.frames.flatMap((frame) =>
      frame.type === "event" &&
      frame.event.kind === "job.updated" &&
      frame.event.job.kind === "surface"
        ? [
            [
              frame.event.job.surfaceId,
              `${frame.event.job.stage}: ${frame.event.job.lastLogLine ?? ""}`,
            ],
          ]
        : [],
    ),
  );
  process.stdout.write(`${JSON.stringify(latest)}\n`);
}, 5000);
try {
  const count =
    project.scene.room.walls.filter((wall) => wall.kind !== "open").length + 2;
  const jobs = await daemon.waitFor({
    label: "real surface jobs",
    timeoutMs: 90 * 60 * 1000,
    read() {
      const latest = Object.fromEntries(
        daemon.frames.flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.kind === "surface"
            ? [[frame.event.job.id, frame.event.job]]
            : [],
        ),
      );
      const jobs = Object.values(latest);
      return jobs.length === count &&
        jobs.every((job) => ["ready", "failed"].includes(job.stage))
        ? jobs
        : undefined;
    },
  });
  for (const job of jobs)
    assert.equal(job.stage, "ready", `${job.surfaceId}: ${job.error}`);
  const result = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  const floor = result.scene.room.surfaces.floor?.material;
  assert.ok(floor?.kind === "tiles", "The benchmark floor must use tiles");
  for (const lengthM of [floor.tileSizeM.u, floor.tileSizeM.v])
    assert.ok(
      Math.abs(lengthM - tileSizeM) / tileSizeM <= 0.15,
      `Floor tile size ${lengthM} m differs by more than 15% from ${tileSizeM} m`,
    );
  const textures = Object.entries(result.scene.room.surfaces).map(
    ([surfaceId, surface]) => ({
      surfaceId,
      material: surface.material,
      image:
        surface.material &&
        surface.material.kind !== "paint" &&
        surface.material.textureAssetId
          ? join(
              copy,
              "assets",
              surface.material.textureAssetId,
              "baseColor.png",
            )
          : undefined,
    }),
  );
  writeJson({
    path: join(fixture.root, "surface-results.json"),
    value: textures,
  });
  process.stdout.write(
    `Measured tiles: ${floor.tileSizeM.u} × ${floor.tileSizeM.v} m. Confirm against photos; inspect wall textures in ${join(fixture.root, "surface-results.json")}\n`,
  );
} finally {
  clearInterval(progress);
  await daemon.stop();
  await fixture.close();
  rmSync(join(fixture.root, "home", "daemon.json"), { force: true });
}
