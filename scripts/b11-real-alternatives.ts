import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { z } from "zod";
import { checkGeneratedAsset } from "../packages/daemon/src/generation/check-generated-asset.ts";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { readInventoryGenerations } from "../packages/daemon/src/generation/read-inventory-generations.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const sourceFolder = process.env.PLANNER_B11_PROJECT ?? process.argv[2];
assert.ok(
  sourceFolder,
  "Usage: node scripts/b11-real-alternatives.ts <inventory-project-folder> (or PLANNER_B11_PROJECT)",
);
const sourceProject = ProjectSchema.parse(
  JSON.parse(readFileSync(join(sourceFolder, "project.json"), "utf8")),
);
const sofa = sourceProject.scene.items.find((item) =>
  /sofa|couch/i.test(item.name),
);
assert.ok(sofa, "The inventory project must contain a sofa");
const saved = z.array(GenerationRecordSchema).parse(
  z
    .array(z.object({ job: z.object({ kind: z.string() }) }).passthrough())
    .parse(
      JSON.parse(
        readFileSync(join(sourceFolder, ".planner/jobs.json"), "utf8"),
      ),
    )
    .filter((record) => record.job.kind === "generation"),
);
const source = [
  ...saved,
  ...readInventoryGenerations({
    folder: sourceFolder,
    projectId: sourceProject.id,
  }),
].find(
  (record) =>
    record.job.itemId === sofa.id && record.source.kind === "inventory",
);
assert.ok(
  source,
  "The sofa must have an inventory generation source and masks",
);
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
      `b11-real-alternatives: running; evidence ${fixture.root}\n`,
    ),
  5000,
);
try {
  const projectId = randomUUID();
  const folder = join(fixture.root, "projects", projectId);
  cpSync(sourceFolder, folder, { recursive: true });
  const project = { ...sourceProject, id: projectId };
  writeJson({ path: join(folder, "project.json"), value: project });
  writeJson({
    path: join(folder, ".planner/jobs.json"),
    value: [
      {
        ...source,
        job: { ...source.job, projectId, stage: "ready" },
        held: true,
        prepared: undefined,
      },
    ],
  });
  const daemon = await fixture.start();
  const { jobIds } = z.object({ jobIds: z.array(z.string()).length(2) }).parse(
    await daemon.command({
      type: "generation.alternatives",
      projectId,
      itemId: sofa.id,
    }),
  );
  const jobs = [];
  for (const id of jobIds) {
    const job = await daemon.waitFor({
      label: `real alternative ${id}`,
      timeoutMs: 2_700_000,
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" && frame.event.kind === "job.updated"
              ? [frame.event.job]
              : [],
          )
          .findLast(
            (job) => job.id === id && ["ready", "failed"].includes(job.stage),
          ),
    });
    jobs.push(job);
  }
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId }),
  );
  const checks = [];
  for (const job of jobs) {
    assert.equal(job.stage, "ready", job.error);
    const block = history.messages
      .find((message) => message.id === job.id)
      ?.blocks.find((block) => block.kind === "asset");
    assert.ok(block);
    const assetFolder = join(folder, "assets", block.assetId);
    const normalized = await checkGeneratedAsset({
      folder: assetFolder,
      placementKind: sofa.placement.kind,
      expected: sofa.sizeM,
      normalized: JSON.parse(
        readFileSync(join(assetFolder, "meta.json"), "utf8"),
      ),
    });
    checks.push({ job, assetId: block.assetId, normalized });
  }
  const opened = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId }),
  );
  assert.deepEqual(
    opened.scene.items.find((item) => item.id === sofa.id),
    sofa,
  );
  writeJson({
    path: join(fixture.root, "gate-b11-real.json"),
    value: { projectId, sourceFolder, checks },
  });
  await daemon.stop();
  process.stdout.write(
    `b11-real-alternatives passed: both workers pass PLAN 5.1; evidence ${fixture.root}\n`,
  );
} finally {
  clearInterval(heartbeat);
  await fixture.close();
  process.stdout.write(`Evidence retained at ${fixture.root}\n`);
}
