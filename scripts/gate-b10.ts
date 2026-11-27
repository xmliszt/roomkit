import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import { createGenerationMaskFixture } from "../packages/daemon/src/generation/create-generation-mask-fixture.ts";
import { InventoryRecordSchema } from "../packages/daemon/src/inventory/inventory-record-schema.ts";
import { readProcessIdentity } from "../packages/daemon/src/jobs/read-process-identity.ts";
import { stopOrphanWorker } from "../packages/daemon/src/python/stop-orphan-worker.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture({
  env: {
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
  },
});
fixture.env.B10_CALLS = join(fixture.root, "modeler-calls.jsonl");
fixture.env.B10_CONTROL = join(fixture.root, "generation-control.json");
writeJson({ path: fixture.env.B10_CONTROL, value: { pause: true } });
const heartbeat = setInterval(
  () => process.stdout.write("gate:b10: waiting for generation jobs\n"),
  5000,
);
try {
  let daemon = await fixture.start();
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      modeler: { cli: "claude", model: "fake-generation" },
    },
  });
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Generation gate",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const bytes = readFileSync(
    new URL("../packages/daemon/test/fixtures/oriented.heic", import.meta.url),
  );
  const response = await fetch(
    `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=room.heic&origin=capture`,
    { method: "POST", headers: { origin: fixture.origin }, body: bytes },
  );
  assert.equal(response.status, 201);
  const photoId = PhotoUploadResultSchema.parse(await response.json()).photoId;
  const folder = join(fixture.root, "projects", project.id);
  const inventoryId = randomUUID();
  const now = new Date().toISOString();
  const objects = [
    { name: "Sofa", sizeM: { width: 1.8, height: 0.8, depth: 0.9 } },
    { name: "Bin", sizeM: { width: 0.3, height: 0.3, depth: 0.3 } },
    { name: "Wrong", sizeM: { width: 0.3, height: 0.2, depth: 0.2 } },
    { name: "Resume", sizeM: { width: 0.3, height: 0.2, depth: 0.2 } },
    { name: "Fallback", sizeM: { width: 0.3, height: 0.2, depth: 0.2 } },
  ];
  const items = objects.map(
    (object) =>
      ({
        ...object,
        id: randomUUID(),
        model: { kind: "pending", jobId: randomUUID() },
        locked: false,
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      }) satisfies Item,
  );
  for (const item of items)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "item.add", item },
    });
  await daemon.stop();
  const photos = JSON.parse(
    readFileSync(join(folder, "photos", "photos.json"), "utf8"),
  ).photos;
  const photo = photos.find(
    (photo: { photoId: string }) => photo.photoId === photoId,
  );
  const maskDir = join(folder, ".planner", "inventory", inventoryId, "masks");
  mkdirSync(maskDir, { recursive: true });
  await createGenerationMaskFixture({
    widthPx: photo.widthPx,
    heightPx: photo.heightPx,
    path: join(maskDir, "mask.png"),
  });
  writeJson({
    path: join(maskDir, "masks.json"),
    value: {
      objects: objects.map((object) => ({
        objectId: object.name,
        views: [{ photoId, maskPath: "mask.png" }],
      })),
    },
  });
  const record = InventoryRecordSchema.parse({
    job: {
      id: inventoryId,
      kind: "inventory",
      projectId: project.id,
      reconstructionJobId: randomUUID(),
      stage: "done",
      progress: 1,
      createdAt: now,
      updatedAt: now,
    },
    photoIds: [photoId],
    scenePath: "unused",
    camerasPath: "unused",
    room: project.scene.room,
    submission: objects.map((object) => ({
      objectId: object.name,
      name: object.name,
      mount: "floor",
      bestPhotoId: photoId,
      views: [
        {
          photoId,
          box: [0, 0, photo.visionWidthPx, photo.visionHeightPx],
          visibility: "mostly-visible",
        },
      ],
    })),
    outcome: {
      items,
      objectIds: objects.map((object) => object.name),
      generationJobs: items.map((item) => ({
        id: item.model.jobId,
        kind: "generation",
        projectId: project.id,
        itemId: item.id,
        stage: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      })),
      undo: [],
      blocks: [],
    },
  });
  writeJson({ path: join(folder, ".planner", "jobs.json"), value: [record] });
  fixture.env.PLANNER_PYTHON_BIN = resolve("scripts/b11-fake-python.mjs");
  fixture.env.B11_ASSET = join(
    folder,
    "assets",
    `asset-${items.at(0)?.model.jobId}`,
    "model.glb",
  );
  daemon = await fixture.start();
  function latest(jobId: string) {
    return daemon.frames
      .flatMap((frame) =>
        frame.type === "snapshot"
          ? frame.jobs
          : frame.type === "event" && frame.event.kind === "job.updated"
            ? [frame.event.job]
            : [],
      )
      .findLast((job) => job.id === jobId);
  }
  async function terminal(jobId: string) {
    return daemon.waitFor({
      label: `generation ${jobId}`,
      timeoutMs: 120000,
      read: () => {
        const job = latest(jobId);
        return job && ["ready", "failed"].includes(job.stage) ? job : undefined;
      },
    });
  }
  const sofa = items.at(0);
  const bin = items.at(1);
  const wrong = items.at(2);
  const resume = items.at(3);
  const fallback = items.at(4);
  assert.ok(sofa && bin && wrong && resume);
  const completed = await terminal(sofa.model.jobId);
  assert.equal(completed.stage, "ready", completed.error);
  assert.equal(latest(bin.model.jobId)?.stage, "queued");
  const asset = AssetMetaSchema.parse(
    JSON.parse(
      readFileSync(
        join(folder, "assets", `asset-${sofa.model.jobId}`, "meta.json"),
        "utf8",
      ),
    ),
  );
  assert.ok(asset.referenceLuma && asset.referenceLuma > 0);
  for (const name of [
    "model.glb",
    "thumb.png",
    "points.bin",
    "lines.bin",
    "colorMask.png",
  ])
    assert.ok(existsSync(join(folder, "assets", asset.id, name)));
  const previewCode = await new Promise<number | null>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve("scripts/b10/preview.ts"),
        join(folder, "assets", asset.id, "model.glb"),
        join(fixture.root, "generated-sofa.png"),
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
  assert.equal(previewCode, 0, "Generated sofa renders in three.js");
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: bin.id,
  });
  const modeledBin = await terminal(bin.model.jobId);
  assert.equal(modeledBin.stage, "ready", modeledBin.error);
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: wrong.id,
  });
  const mismatched = await terminal(wrong.model.jobId);
  assert.equal(mismatched.stage, "ready", mismatched.error);
  assert.match(
    readFileSync(
      join(
        fixture.root,
        "projects",
        project.id,
        ".planner/generation",
        wrong.model.jobId,
        "worker.log",
      ),
      "utf8",
    ),
    /Size differs from the estimate: \w+ \d+\.\d+ m vs estimate \d+\.\d+ m/,
  );
  function calls() {
    return readFileSync(fixture.env.B10_CALLS ?? "", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }
  assert.deepEqual(
    calls()
      .filter((call) => call.name === "Wrong")
      .map((call) => call.hasFeedback),
    [false, true],
    "the second modeler prompt carries the Wrong proportions feedback",
  );
  assert.ok(fallback);
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: fallback.id,
  });
  const fellBack = await terminal(fallback.model.jobId);
  assert.equal(fellBack.stage, "ready", fellBack.error);
  assert.match(
    readFileSync(
      join(folder, ".planner/generation", fallback.model.jobId, "worker.log"),
      "utf8",
    ),
    /Retry failed \(Modeler finished without asset_submit\); published the first attempt/,
  );
  const fallbackRecord = z
    .object({
      assetId: z.string(),
      sizeMismatches: z.array(z.object({ axis: z.string() })).optional(),
    })
    .parse(
      z
        .array(z.object({ job: z.object({ id: z.string() }) }).passthrough())
        .parse(
          JSON.parse(readFileSync(join(folder, ".planner/jobs.json"), "utf8")),
        )
        .find((record) => record.job.id === fallback.model.jobId),
    );
  assert.deepEqual(
    fallbackRecord.sizeMismatches?.map((mismatch) => mismatch.axis),
    ["depth"],
  );
  assert.ok(
    existsSync(join(folder, "assets", fallbackRecord.assetId, "model.glb")),
    "the first attempt's model is published",
  );
  const resizedSofa = { width: 2.4, height: 0.8, depth: 0.9 };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: sofa.id,
      patch: { sizeM: resizedSofa },
    },
  });
  const count = calls().length;
  await daemon.command({
    type: "chat.send",
    projectId: project.id,
    text: "[fake:generation-variant] Make a blue sofa",
  });
  const variant = await daemon.waitFor({
    label: "colour variant",
    timeoutMs: 120000,
    read: () => {
      const jobs = daemon.frames.flatMap((frame) =>
        frame.type === "event" && frame.event.kind === "job.updated"
          ? [frame.event.job]
          : [],
      );
      return jobs.find(
        (job) =>
          job.kind === "generation" &&
          !items.some((item) => item.model.jobId === job.id) &&
          ["ready", "failed"].includes(job.stage),
      );
    },
  });
  assert.equal(variant.stage, "ready", variant.error);
  assert.ok(variant.kind === "generation");
  assert.equal(calls().length, count);
  const variantProject = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  const blueSofa = variantProject.scene.items.find(
    (item) => item.id === variant.itemId,
  );
  assert.deepEqual(
    blueSofa && {
      width: blueSofa.sizeM.width.toFixed(2),
      height: blueSofa.sizeM.height.toFixed(2),
      depth: blueSofa.sizeM.depth.toFixed(2),
    },
    { width: "2.40", height: "1.07", depth: "1.20" },
    "a colour variant of a stretched sofa keeps the model's proportions",
  );
  assert.ok(blueSofa?.model.kind === "asset");
  const variantMeta = AssetMetaSchema.parse(
    JSON.parse(
      readFileSync(
        join(folder, "assets", blueSofa.model.assetId, "meta.json"),
        "utf8",
      ),
    ),
  );
  for (const dimension of ["width", "height", "depth"] as const)
    assert.ok(
      Math.abs(
        variantMeta.nativeSizeM[dimension] - asset.nativeSizeM[dimension],
      ) < 0.001,
    );
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      modeler: { cli: "codex", model: "fake-generation" },
    },
  });
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: resume.id,
  });
  const paused = await daemon.waitFor({
    label: "paused modeler",
    read: () => calls().find((call) => call.name === "Resume"),
  });
  await daemon.stop("SIGKILL");
  writeJson({ path: fixture.env.B10_CONTROL, value: { pause: false } });
  daemon = await fixture.start();
  const resumed = await terminal(resume.model.jobId);
  assert.equal(resumed.stage, "ready", resumed.error);
  assert.equal(readProcessIdentity(paused.pid), undefined);
  const opened = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.equal(
    opened.scene.items.find((item) => item.id === wrong.id)?.model.kind,
    "asset",
  );
  assert.equal(
    opened.scene.items.find((item) => item.id === resume.id)?.model.kind,
    "asset",
  );
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: sofa.id,
      patch: { sizeM: sofa.sizeM },
    },
  });
  const originalSofa = {
    ...opened.scene.items.find((item) => item.id === sofa.id),
    sizeM: sofa.sizeM,
  };
  const alternatives = await daemon.command({
    type: "generation.alternatives",
    projectId: project.id,
    itemId: sofa.id,
  });
  const alternativeIds = z
    .object({ jobIds: z.array(z.string()).length(2) })
    .parse(alternatives).jobIds;
  for (const id of alternativeIds) {
    const result = await terminal(id);
    assert.equal(result.stage, "ready", result.error);
  }
  const afterAlternatives = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(
    afterAlternatives.scene.items.find((item) => item.id === sofa.id),
    originalSofa,
  );
  await daemon.command({
    type: "chat.send",
    projectId: project.id,
    text: "[fake:generation-request] Build from this photo",
  });
  const generated = await daemon.waitFor({
    label: "photo request",
    timeoutMs: 120000,
    read: () => {
      const jobs = daemon.frames.flatMap((frame) =>
        frame.type === "event" && frame.event.kind === "job.updated"
          ? [frame.event.job]
          : [],
      );
      return jobs.find(
        (job) =>
          job.kind === "generation" &&
          !items.some((item) => item.model.jobId === job.id) &&
          job.id !== variant.id &&
          ["ready", "failed"].includes(job.stage),
      );
    },
  });
  assert.equal(generated.stage, "ready", generated.error);
  const chat = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  for (const id of [...alternativeIds, generated.id, variant.id])
    assert.equal(
      chat.messages
        .find((message) => message.id === id)
        ?.blocks.filter((block) => block.kind === "asset").length,
      1,
    );
  for (const name of ["points.bin", "lines.bin", "colorMask.png"]) {
    const response = await fetch(
      `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/assets/${asset.id}/${name}`,
      { headers: { origin: fixture.origin } },
    );
    assert.equal(response.status, 200);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  await daemon.stop();
  process.stdout.write(
    "gate:b10 passed: automatic sofa, held bin released by command, wrong proportions published after one feedback retry, a failed retry publishing the first attempt, resized colour variant without modeler, three.js render, Codex SIGKILL recovery, two alternative assets, photo request, asset chat blocks and sidecar routes\n",
  );
} finally {
  clearInterval(heartbeat);
  await stopOrphanWorker(join(fixture.root, "home", "generation-worker.json"));
  await fixture.close();
}
