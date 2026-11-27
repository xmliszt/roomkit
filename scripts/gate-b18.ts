import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import { createGenerationMaskFixture } from "../packages/daemon/src/generation/create-generation-mask-fixture.ts";
import { InventoryRecordSchema } from "../packages/daemon/src/inventory/inventory-record-schema.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture({
  env: {
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
    PLANNER_CLAUDE_BIN: resolve("packages/daemon/test/b18/fake-cli.mjs"),
    PLANNER_CODEX_BIN: resolve("packages/daemon/test/b18/fake-cli.mjs"),
  },
});
const heartbeat = setInterval(
  () => process.stdout.write("gate:b18: checking regeneration\n"),
  5000,
);
try {
  let daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Regeneration gate",
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
    { name: "Coffee table", sizeM: { width: 1.2, height: 0.4, depth: 0.6 } },
  ];
  const items = objects.map(
    (object) =>
      ({
        ...object,
        id: randomUUID(),
        model: { kind: "pending", jobId: randomUUID() },
        locked: true,
        mirrored: true,
        colorAdjust: { kind: "colorize", color: "#123456", strength: 0.6 },
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
        objectId: object.name.replaceAll(" ", "-"),
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
      objectId: object.name.replaceAll(" ", "-"),
      name: object.name,
      mount: "floor",
      bestPhotoId: photoId,
      views: [
        {
          photoId,
          box: [2, 2, photo.visionWidthPx - 2, photo.visionHeightPx - 2],
          visibility: "mostly-visible",
        },
      ],
    })),
    outcome: {
      items,
      objectIds: objects.map((object) => object.name.replaceAll(" ", "-")),
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
  async function ready(jobId: string) {
    const job = await daemon.waitFor({
      label: jobId,
      timeoutMs: 120000,
      read: () => {
        const job = latest(jobId);
        return job && ["ready", "failed"].includes(job.stage) ? job : undefined;
      },
    });
    assert.equal(job.stage, "ready", job.error);
  }
  async function current() {
    return ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    ).scene.items.at(0);
  }
  const item = items.at(0);
  assert.ok(item);
  await ready(item.model.jobId);
  const original = await current();
  assert.ok(original?.model.kind === "asset");
  const notes = "It has only 3 legs; the legs are oval";
  const request = {
    type: "generation.regenerate",
    projectId: project.id,
    itemId: item.id,
    notes,
  };
  const regenerated = z
    .object({ jobId: z.string() })
    .parse(await daemon.command(request));
  assert.notEqual(regenerated.jobId, item.model.jobId);
  assert.deepEqual(await daemon.command(request), regenerated);
  assert.deepEqual(
    await current(),
    original,
    "Old model stays while its replacement runs",
  );
  const editedOriginal = {
    ...original,
    sizeM: { width: 1.5, height: 0.5, depth: 0.8 },
  };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: item.id,
      patch: { sizeM: editedOriginal.sizeM },
    },
  });
  await ready(regenerated.jobId);
  const replacement = await current();
  assert.ok(replacement?.model.kind === "asset");
  assert.notEqual(replacement.model.assetId, original.model.assetId);
  assert.deepEqual(replacement, {
    ...editedOriginal,
    model: replacement.model,
  });
  const sourceDir = join(folder, ".planner", "generation", item.model.jobId);
  const regenDir = join(folder, ".planner", "generation", regenerated.jobId);
  const originalJob = JSON.parse(
    readFileSync(join(sourceDir, "job.json"), "utf8"),
  );
  const newJob = JSON.parse(readFileSync(join(regenDir, "job.json"), "utf8"));
  assert.equal(newJob.notes, notes);
  assert.deepEqual(newJob.reference, originalJob.reference);
  assert.deepEqual(newJob.photos, originalJob.photos);
  assert.deepEqual(newJob.masks, originalJob.masks);
  for (const path of [...newJob.photos, ...newJob.masks])
    assert.deepEqual(
      readFileSync(join(sourceDir, path)),
      readFileSync(join(regenDir, path)),
      path,
    );
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  const diff = history.messages
    .find((message) => message.id === regenerated.jobId)
    ?.blocks.find((block) => block.kind === "diff");
  assert.ok(diff?.kind === "diff");
  assert.equal(diff.undo.length, 1);
  assert.deepEqual(diff.undo, [
    { type: "item.update", itemId: item.id, patch: { model: original.model } },
  ]);
  const asset = history.messages
    .find((message) => message.id === regenerated.jobId)
    ?.blocks.find((block) => block.kind === "asset");
  assert.ok(asset?.kind === "asset");
  assert.deepEqual(asset.sizeM, editedOriginal.sizeM);
  for (const command of diff.undo)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  assert.deepEqual(
    await current(),
    editedOriginal,
    "Undo restores the original model and keeps the current item properties",
  );
  await daemon.stop();
  daemon = await fixture.start();
  assert.deepEqual(
    await current(),
    editedOriginal,
    "Restart must preserve undo",
  );
  const sent = z.object({ agentMessageId: z.string() }).parse(
    await daemon.command({
      type: "chat.send",
      projectId: project.id,
      text: "regenerate this, the legs are oval",
      itemIds: [item.id],
    }),
  );
  await daemon.waitFor({
    label: "designer regeneration",
    read: () =>
      daemon.frames.find(
        (frame) =>
          frame.type === "event" &&
          frame.event.kind === "chat.message.finished" &&
          frame.event.messageId === sent.agentMessageId,
      ),
  });
  const chat = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  const tool = chat.messages
    .find((message) => message.id === sent.agentMessageId)
    ?.blocks.find(
      (block) =>
        block.kind === "tool" && block.name.includes("asset_regenerate"),
    );
  assert.ok(tool?.kind === "tool");
  assert.equal(tool.status, "done");
  assert.deepEqual(tool.arguments, {
    itemId: item.id,
    notes: "the legs are oval",
  });
  const designerJob = await daemon.waitFor({
    label: "designer generation job",
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" && frame.event.kind === "job.updated"
            ? [frame.event.job]
            : [],
        )
        .find(
          (job) =>
            job.kind === "generation" &&
            job.itemId === item.id &&
            job.id !== regenerated.jobId &&
            job.id !== item.model.jobId,
        ),
  });
  await ready(designerJob.id);
  await daemon.stop();
  process.stdout.write(
    "gate:b18 passed: same inventory crops and masks, notes in job.json, old model retained, undo and restart, designer item-chip tool call\n",
  );
} finally {
  clearInterval(heartbeat);
  await fixture.close();
}
