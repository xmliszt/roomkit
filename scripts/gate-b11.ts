import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import { checkGeneratedAsset } from "../packages/daemon/src/generation/check-generated-asset.ts";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture({
  env: {
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
    PLANNER_PYTHON_BIN: resolve("scripts/b11-fake-python.mjs"),
  },
});
fixture.env.PLANNER_MACHINE_LOCK = join(fixture.root, "machine.lock");
fixture.env.B11_CALLS = join(fixture.root, "alternatives.jsonl");
fixture.env.B11_CONTROL = join(fixture.root, "fake-control.json");
const heartbeat = setInterval(
  () => process.stdout.write("gate:b11: waiting for alternatives\n"),
  5000,
);
try {
  let daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Alternatives",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const folder = join(fixture.root, "projects", project.id);
  const item: Item = {
    id: randomUUID(),
    name: "Charging port",
    model: { kind: "asset", assetId: CHARGING_PORT.assetId },
    placement: {
      kind: "wall",
      wallId: project.scene.room.walls.at(0)?.id ?? "",
      alongM: 1.2,
      heightM: 0.3,
      rotationRad: 0,
    },
    sizeM: CHARGING_PORT.sizeM,
    locked: false,
  };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item },
  });
  const catalog = resolve("packages/daemon/catalog", CHARGING_PORT.assetId);
  const target = join(folder, "assets", CHARGING_PORT.assetId);
  function hash(path: string) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  for (const name of ["model.glb", "meta.json", "thumb.png"])
    writeFileSync(join(target, name), "stale");
  writeFileSync(join(target, "obsolete.txt"), "old");
  const opened = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(opened.scene.items, [item]);
  assert.equal(opened.revision, 1);
  for (const name of ["model.glb", "meta.json", "thumb.png"])
    assert.equal(hash(join(target, name)), hash(join(catalog, name)));
  assert.equal(existsSync(join(target, "obsolete.txt")), false);
  rmSync(join(target, "thumb.png"));
  await daemon.command({ type: "project.open", projectId: project.id });
  assert.equal(
    hash(join(target, "thumb.png")),
    hash(join(catalog, "thumb.png")),
  );
  fixture.env.B11_ASSET = join(target, "model.glb");
  const response = await fetch(
    `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=room.heic&origin=capture`,
    {
      method: "POST",
      headers: { origin: fixture.origin },
      body: readFileSync("packages/daemon/test/fixtures/oriented.heic"),
    },
  );
  assert.equal(response.status, 201);
  const photoId = PhotoUploadResultSchema.parse(await response.json()).photoId;
  await daemon.stop();
  const inventoryJobId = randomUUID();
  const maskDir = join(folder, ".planner/inventory", inventoryJobId, "masks");
  mkdirSync(maskDir, { recursive: true });
  const { createGenerationMaskFixture } = await import(
    "../packages/daemon/src/generation/create-generation-mask-fixture.ts"
  );
  const { readPhotos } = await import(
    "../packages/daemon/src/photos/read-photos.ts"
  );
  const photo = readPhotos(folder).find((photo) => photo.photoId === photoId);
  assert.ok(photo?.kind === "accepted");
  await createGenerationMaskFixture({
    path: join(maskDir, "mask.png"),
    widthPx: photo.widthPx,
    heightPx: photo.heightPx,
  });
  writeJson({
    path: join(maskDir, "masks.json"),
    value: {
      objects: [
        { objectId: "port", views: [{ photoId, maskPath: "mask.png" }] },
      ],
    },
  });
  const now = new Date().toISOString();
  const record = GenerationRecordSchema.parse({
    job: {
      id: randomUUID(),
      kind: "generation",
      projectId: project.id,
      itemId: item.id,
      stage: "ready",
      progress: 1,
      createdAt: now,
      updatedAt: now,
    },
    item,
    source: {
      kind: "inventory",
      inventoryJobId,
      object: {
        objectId: "port",
        name: "Port",
        mount: "wall",
        bestPhotoId: photoId,
        views: [
          {
            photoId,
            box: [
              0,
              0,
              Math.floor(photo.visionWidthPx / 2),
              Math.floor(photo.visionHeightPx / 2),
            ],
            visibility: "mostly-visible",
          },
        ],
      },
    },
    prompt: "fixture",
    held: false,
    attempt: 0,
    assetId: CHARGING_PORT.assetId,
  });
  writeJson({ path: join(folder, ".planner/jobs.json"), value: [record] });
  fixture.env.B11_WIDTH = String(photo.widthPx);
  fixture.env.B11_HEIGHT = String(photo.heightPx);
  daemon = await fixture.start();
  async function alternatives() {
    const { jobIds } = z
      .object({ jobIds: z.array(z.string()).length(2) })
      .parse(
        await daemon.command({
          type: "generation.alternatives",
          projectId: project.id,
          itemId: item.id,
        }),
      );
    return Promise.all(
      jobIds.map((id) =>
        daemon.waitFor({
          label: `alternative ${id}`,
          timeoutMs: 120000,
          read: () =>
            daemon.frames
              .flatMap((frame) =>
                frame.type === "event" && frame.event.kind === "job.updated"
                  ? [frame.event.job]
                  : [],
              )
              .findLast(
                (job) =>
                  job.id === id && ["ready", "failed"].includes(job.stage),
              ),
        }),
      ),
    );
  }
  const results = await alternatives();
  for (const result of results)
    assert.equal(result.stage, "ready", result.error);
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  for (const result of results) {
    const blocks = history.messages
      .find((message) => message.id === result.id)
      ?.blocks.filter((block) => block.kind === "asset");
    assert.equal(blocks?.length, 1);
    const block = blocks?.at(0);
    assert.ok(block);
    const assetFolder = join(folder, "assets", block.assetId);
    await checkGeneratedAsset({
      folder: assetFolder,
      placementKind: item.placement.kind,
      expected: item.sizeM,
      normalized: JSON.parse(
        readFileSync(join(assetFolder, "meta.json"), "utf8"),
      ),
    });
    for (const axis of [
      "width",
      "height",
      "depth",
    ] satisfies (keyof Item["sizeM"])[])
      assert.ok(
        Math.abs(block.sizeM[axis] / item.sizeM[axis] - 1) < 0.001,
        "source axes must normalize back to the catalog dimensions",
      );
  }
  const calls = z
    .array(
      z.object({
        worker: z.string(),
        photoPath: z.string(),
        maskPath: z.string(),
      }),
    )
    .parse(
      readFileSync(fixture.env.B11_CALLS, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
  assert.deepEqual(calls.map((call) => call.worker).toSorted(), [
    "generate_sam3d",
    "generate_trellis",
  ]);
  assert.deepEqual(
    ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    ).scene.items,
    [item],
  );
  rmSync(
    join(fixture.root, "home/python/weights/trellis2/fixture.safetensors"),
  );
  const missing = await alternatives();
  assert.equal(
    missing.find(
      (job) =>
        job.kind === "generation-alternative" && job.method === "trellis2",
    )?.stage,
    "failed",
  );
  assert.equal(
    missing.find(
      (job) => job.kind === "generation-alternative" && job.method === "sam3d",
    )?.stage,
    "ready",
  );
  const failedId = missing.find((job) => job.stage === "failed")?.id;
  const notices = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  ).messages.find((message) => message.id === failedId)?.blocks;
  assert.ok(
    notices?.some(
      (block) =>
        block.kind === "notice" &&
        block.detail.kind === "missing-requirement" &&
        block.detail.settingsSection === "python",
    ),
  );
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: item.id,
      patch: { sizeM: { ...item.sizeM, height: item.sizeM.height * 3 } },
    },
  });
  const { jobIds: mismatchedIds } = z
    .object({ jobIds: z.array(z.string()).length(1) })
    .parse(
      await daemon.command({
        type: "generation.alternatives",
        projectId: project.id,
        itemId: item.id,
        method: "sam3d",
      }),
    );
  const mismatchedId = mismatchedIds.at(0) ?? "";
  const mismatched = await daemon.waitFor({
    label: "mismatched alternative",
    timeoutMs: 120000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" && frame.event.kind === "job.updated"
            ? [frame.event.job]
            : [],
        )
        .findLast(
          (job) =>
            job.id === mismatchedId && ["ready", "failed"].includes(job.stage),
        ),
  });
  assert.equal(mismatched.stage, "ready", mismatched.error);
  assert.match(
    readFileSync(
      join(folder, ".planner/generation", mismatchedId, "worker.log"),
      "utf8",
    ),
    /Size differs from the estimate: width \d+\.\d+ m vs estimate \d+\.\d+ m/,
  );
  const mismatchedBlock = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  )
    .messages.find((message) => message.id === mismatchedId)
    ?.blocks.find((block) => block.kind === "asset");
  assert.deepEqual(
    mismatchedBlock?.kind === "asset"
      ? mismatchedBlock.sizeMismatches?.map((mismatch) => mismatch.axis)
      : undefined,
    ["width", "depth"],
    "the stored size difference is on the asset block",
  );
  writeFileSync(fixture.env.B11_CONTROL, JSON.stringify({ flat: true }));
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: item.id,
      patch: {
        placement: {
          kind: "floor",
          xM: 1,
          zM: 1,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 2, height: 0.005, depth: 1.4 },
      },
    },
  });
  const rejectedId = z
    .object({ jobIds: z.array(z.string()).length(1) })
    .parse(
      await daemon.command({
        type: "generation.alternatives",
        projectId: project.id,
        itemId: item.id,
        method: "sam3d",
      }),
    )
    .jobIds.at(0);
  assert.ok(rejectedId);
  const rejected = await daemon.waitFor({
    label: "rejected alternative",
    timeoutMs: 120000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" && frame.event.kind === "job.updated"
            ? [frame.event.job]
            : [],
        )
        .findLast(
          (job) =>
            job.id === rejectedId && ["ready", "failed"].includes(job.stage),
        ),
  });
  assert.equal(rejected.stage, "failed");
  assert.match(rejected.error ?? "", /^Floor covering too thin/);
  assert.equal(
    rejected.kind === "generation-alternative" && rejected.hasRejectedModel,
    true,
  );
  const preview = await fetch(
    `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/rejected/${rejectedId}/thumb.png`,
    { headers: { origin: fixture.origin } },
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  const rejectedAssetId = GenerationRecordSchema.array()
    .parse(JSON.parse(readFileSync(join(folder, ".planner/jobs.json"), "utf8")))
    .find((record) => record.job.id === rejectedId)?.assetId;
  assert.ok(rejectedAssetId);
  assert.equal(existsSync(join(folder, "assets", rejectedAssetId)), false);
  assert.equal(existsSync(fixture.env.PLANNER_MACHINE_LOCK), false);
  await daemon.stop();
  process.stdout.write(
    "gate:b11 passed: two C3 workers, source axes, normalized asset blocks, unchanged item, missing weights notice, mismatched proportions published as information, a rejected model kept for preview only, stale and incomplete catalog copies refreshed\n",
  );
} finally {
  clearInterval(heartbeat);
  await fixture.close();
}
