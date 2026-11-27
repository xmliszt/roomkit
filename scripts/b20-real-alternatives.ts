import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { z } from "zod";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const sourceFolder = process.env.PLANNER_B20_PROJECT ?? process.argv[2];
assert.ok(
  sourceFolder,
  "Usage: node scripts/b20-real-alternatives.ts <project-folder> <alternative-job-id>... (or PLANNER_B20_PROJECT)",
);
const sourceJobIds = process.argv.slice(3);
assert.ok(
  sourceJobIds.length > 0,
  "Name at least one earlier alternative job whose item and reference to reuse",
);
const evidenceDir = resolve("docs/work-packages/evidence");
const sourceProject = ProjectSchema.parse(
  JSON.parse(readFileSync(join(sourceFolder, "project.json"), "utf8")),
);
const savedRecords = z
  .array(
    z
      .object({
        job: z.object({ id: z.string(), kind: z.string() }).passthrough(),
      })
      .passthrough(),
  )
  .parse(
    JSON.parse(readFileSync(join(sourceFolder, ".planner/jobs.json"), "utf8")),
  )
  .filter((record) => record.job.kind === "generation-alternative");
const sources = sourceJobIds.map((prefix) => {
  const saved = savedRecords.find((record) => record.job.id.startsWith(prefix));
  assert.ok(saved, `No job ${prefix} in the source project`);
  const record = GenerationRecordSchema.parse(saved);
  assert.equal(record.job.kind, "generation-alternative");
  return { prefix, record };
});
const fixture = await createReconFixture({
  real: true,
  keep: true,
  env: {
    PLANNER_PYTHON_BIN:
      process.env.PLANNER_PYTHON_BIN ?? resolve("python/.venv/bin/python"),
    PLANNER_WEIGHTS_DIR:
      process.env.PLANNER_WEIGHTS_DIR ??
      join(homedir(), ".interior-planner/python/weights"),
    PLANNER_MACHINE_LOCK:
      process.env.PLANNER_MACHINE_LOCK ??
      join(homedir(), ".cache/interior-planner-machine.lock"),
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
  },
});
const heartbeat = setInterval(
  () =>
    process.stdout.write(
      `b20-real-alternatives: running; evidence ${fixture.root}\n`,
    ),
  30_000,
);
try {
  const projectId = crypto.randomUUID();
  const folder = join(fixture.root, "projects", projectId);
  mkdirSync(join(folder, ".planner"), { recursive: true });
  for (const name of ["photos", "assets"])
    cpSync(join(sourceFolder, name), join(folder, name), { recursive: true });
  for (const { record } of sources)
    if (record.source.kind === "inventory")
      cpSync(
        join(sourceFolder, ".planner/inventory", record.source.inventoryJobId),
        join(folder, ".planner/inventory", record.source.inventoryJobId),
        { recursive: true },
      );
  const firstPerItem = sources
    .map(({ record }) => record)
    .filter(
      (record, index, records) =>
        records.findIndex((other) => other.item.id === record.item.id) ===
        index,
    );
  const items = firstPerItem.map((record) => record.item);
  writeJson({
    path: join(folder, "project.json"),
    value: {
      ...sourceProject,
      id: projectId,
      scene: { ...sourceProject.scene, items },
    },
  });
  writeJson({
    path: join(folder, ".planner/jobs.json"),
    value: firstPerItem.map((record) => ({
      ...record,
      job: {
        id: crypto.randomUUID(),
        kind: "generation",
        projectId,
        itemId: record.job.itemId,
        stage: "ready",
        progress: 1,
        createdAt: record.job.createdAt,
        updatedAt: record.job.updatedAt,
      },
      held: false,
      attempt: 0,
      prepared: undefined,
      gateFailure: undefined,
    })),
  });
  const daemon = await fixture.start();
  const queued = [];
  for (const { prefix, record } of sources) {
    const { jobIds } = z
      .object({ jobIds: z.array(z.string()).length(1) })
      .parse(
        await daemon.command({
          type: "generation.alternatives",
          projectId,
          itemId: record.job.itemId,
          method:
            record.job.kind === "generation-alternative"
              ? record.job.method
              : undefined,
        }),
      );
    queued.push({ prefix, record, jobId: jobIds.at(0) ?? "" });
  }
  const results = [];
  for (const entry of queued) {
    const job = await daemon.waitFor({
      label: `real alternative ${entry.jobId}`,
      timeoutMs: 4 * 3_600_000,
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" && frame.event.kind === "job.updated"
              ? [frame.event.job]
              : [],
          )
          .findLast(
            (job) =>
              job.id === entry.jobId && ["ready", "failed"].includes(job.stage),
          ),
    });
    const jobFolder = join(folder, ".planner/generation", entry.jobId);
    const log = existsSync(join(jobFolder, "worker.log"))
      ? readFileSync(join(jobFolder, "worker.log"), "utf8")
      : "";
    const metricsPath = join(jobFolder, "worker/metrics.json");
    const metrics = existsSync(metricsPath)
      ? JSON.parse(readFileSync(metricsPath, "utf8"))
      : undefined;
    const method =
      entry.record.job.kind === "generation-alternative"
        ? entry.record.job.method
        : "unknown";
    const slug = `${entry.record.item.name.split(" (")[0]?.toLowerCase().replaceAll(" ", "-")}-${method}`;
    const saved = z
      .array(
        z
          .object({
            job: z.object({ id: z.string() }),
            assetId: z.string(),
            sizeMismatches: z.array(z.unknown()).optional(),
          })
          .passthrough(),
      )
      .parse(
        JSON.parse(readFileSync(join(folder, ".planner/jobs.json"), "utf8")),
      )
      .find((record) => record.job.id === entry.jobId);
    const assetId = saved?.assetId;
    const render =
      job.stage === "ready"
        ? join(folder, "assets", assetId ?? "", "thumb.png")
        : join(jobFolder, "normalized/thumb.png");
    const evidenceRender = join(evidenceDir, `b20-${slug}-after.png`);
    if (existsSync(render)) copyFileSync(render, evidenceRender);
    results.push({
      source: entry.prefix,
      jobId: entry.jobId,
      item: entry.record.item.name,
      expectedSizeM: entry.record.item.sizeM,
      method,
      stage: job.stage,
      error: job.error,
      hasRejectedModel:
        job.kind === "generation-alternative"
          ? job.hasRejectedModel
          : undefined,
      sizeMismatches: saved?.sizeMismatches,
      metrics,
      sampleStepFrames: log
        .split("\n")
        .filter((line) => line.includes('"step"')).length,
      normalized: log
        .split("\n")
        .findLast((line) => line.startsWith("RESULT "))
        ?.slice(0, 600),
      retried: log.includes("retrying at 50,000 faces"),
      render: existsSync(render) ? evidenceRender : undefined,
    });
  }
  writeJson({
    path: join(fixture.root, "b20-real.json"),
    value: { projectId, sourceFolder, results },
  });
  writeJson({
    path: join(evidenceDir, "b20-real-runs.json"),
    value: { results },
  });
  await daemon.stop();
  for (const result of results)
    process.stdout.write(
      `b20-real-alternatives: ${result.item} / ${result.method}: ${result.stage}${result.error ? ` (${result.error})` : ""}; ${Math.round(result.metrics?.durationSeconds ?? 0)} s; peak ${result.metrics?.peakMemoryGb?.toFixed(1)} GB; longest silence ${result.metrics?.maxSilentSeconds} s\n`,
    );
  assert.ok(
    results.every((result) => result.stage === "ready"),
    "every real alternative must be ready",
  );
} finally {
  clearInterval(heartbeat);
  await fixture.close();
  process.stdout.write(`Evidence retained at ${fixture.root}\n`);
}
