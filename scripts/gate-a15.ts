import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { z } from "zod";
import { createGenerationMaskFixture } from "../packages/daemon/src/generation/create-generation-mask-fixture.ts";
import { readPhotos } from "../packages/daemon/src/photos/read-photos.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture({
  env: {
    PLANNER_PYTHON_BIN: resolve("scripts/b7/fake-python.mjs"),
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
  },
});
const progress = setInterval(
  () => process.stdout.write("gate:a15 running\n"),
  5000,
);
try {
  const daemon = await fixture.start();
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      surveyor: { cli: "claude", model: "fake-inventory-openings" },
      modeler: { cli: "claude", model: "fake-generation" },
    },
  });
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Opening inventory",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  for (const index of [1, 2]) {
    const response = await fetch(
      `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=photo-${index}.heic&origin=capture`,
      {
        method: "POST",
        headers: { origin: fixture.origin },
        body: readFileSync("packages/daemon/test/fixtures/oriented.heic"),
      },
    );
    assert.equal(response.status, 201);
  }
  await daemon.command({ type: "reconstruction.start", projectId: project.id });
  const inventory = await daemon.waitFor({
    label: "opening inventory",
    timeoutMs: 60000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.kind === "inventory" &&
          ["done", "failed"].includes(frame.event.job.stage)
            ? [frame.event.job]
            : [],
        )
        .at(-1),
  });
  assert.equal(inventory.stage, "done", inventory.error);
  const inventoried = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.equal(
    inventoried.scene.items.find((item) => item.name === "Sliding door")
      ?.cutsOpening,
    true,
  );
  process.stdout.write(
    "Fake-surveyor door passes cutsOpening through inventory.\n",
  );

  const inventoryProjectFolder = join(fixture.root, "projects", project.id);
  const masksFolder = join(
    inventoryProjectFolder,
    ".planner",
    "inventory",
    inventory.id,
    "masks",
  );
  const masks = JSON.parse(
    readFileSync(join(masksFolder, "masks.json"), "utf8"),
  );
  for (const object of masks.objects) {
    for (const view of object.views) {
      const photo = readPhotos(inventoryProjectFolder).find(
        (photo) => photo.photoId === view.photoId,
      );
      assert.ok(photo?.kind === "accepted");
      await createGenerationMaskFixture({
        path: join(masksFolder, view.maskPath),
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
      });
    }
  }
  const door = inventoried.scene.items.find(
    (item) => item.name === "Sliding door",
  );
  assert.ok(door?.model.kind === "pending");
  const generationJobId = door.model.jobId;
  const sizeM = { width: 2.34, height: 2.33, depth: 0.85 };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.update", itemId: door.id, patch: { sizeM } },
  });
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: door.id,
  });
  const generated = await daemon.waitFor({
    label: "opening generation",
    timeoutMs: 300000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.id === generationJobId &&
          ["ready", "failed"].includes(frame.event.job.stage)
            ? [frame.event.job]
            : [],
        )
        .at(-1),
  });
  assert.equal(generated.stage, "ready", generated.error);
  const finished = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === door.id);
  assert.ok(finished?.model.kind === "asset");
  assert.deepEqual(finished.sizeM, sizeM);
  const generationFolder = join(
    fixture.root,
    "projects",
    project.id,
    ".planner",
    "generation",
    generationJobId,
  );
  const job = JSON.parse(
    readFileSync(join(generationFolder, "job.json"), "utf8"),
  );
  assert.deepEqual(job.sizeM, { ...sizeM, depth: 0.25 });
  const meta = JSON.parse(
    readFileSync(
      join(
        fixture.root,
        "projects",
        project.id,
        "assets",
        finished.model.assetId,
        "meta.json",
      ),
      "utf8",
    ),
  );
  assert.ok(Math.abs(meta.nativeSizeM.depth - 0.25) < 0.001);
  process.stdout.write(
    "Opening generation uses a capped target and preserves stored dimensions.\n",
  );

  const notes = "Keep the frame thin and remove anything behind it.";
  const regeneration = z.object({ jobId: z.string() }).parse(
    await daemon.command({
      type: "generation.regenerate",
      projectId: project.id,
      itemId: door.id,
      notes,
    }),
  );
  const replacementJob = await daemon.waitFor({
    label: "opening regeneration",
    timeoutMs: 300000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.id === regeneration.jobId &&
          ["ready", "failed"].includes(frame.event.job.stage)
            ? [frame.event.job]
            : [],
        )
        .at(-1),
  });
  assert.equal(replacementJob.stage, "ready", replacementJob.error);
  const replacement = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === door.id);
  assert.ok(replacement?.model.kind === "asset");
  assert.notDeepEqual(replacement.model, finished.model);
  assert.deepEqual(replacement, { ...finished, model: replacement.model });
  const regeneratedInput = JSON.parse(
    readFileSync(
      join(
        inventoryProjectFolder,
        ".planner",
        "generation",
        regeneration.jobId,
        "job.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(regeneratedInput.sizeM, { ...sizeM, depth: 0.25 });
  assert.equal(regeneratedInput.notes, notes);
  assert.deepEqual(regeneratedInput.reference, job.reference);
  assert.deepEqual(regeneratedInput.photos, job.photos);
  assert.deepEqual(regeneratedInput.masks, job.masks);
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  const diff = history.messages
    .find((message) => message.id === regeneration.jobId)
    ?.blocks.find((block) => block.kind === "diff");
  assert.ok(diff?.kind === "diff");
  assert.deepEqual(diff.undo, [
    { type: "item.update", itemId: door.id, patch: { model: finished.model } },
  ]);
  for (const command of diff.undo)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  const undone = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === door.id);
  assert.deepEqual(undone, finished);
  process.stdout.write(
    "Opening regeneration preserves sources, notes, dimensions and model-only undo.\n",
  );

  const saved = ProjectSchema.parse(
    JSON.parse(readFileSync("scripts/a15/project.json", "utf8")),
  );
  const folder = join(fixture.root, "projects", saved.id);
  mkdirSync(folder, { recursive: true });
  copyFileSync("scripts/a15/project.json", join(folder, "project.json"));
  const before = readFileSync(join(folder, "project.json"), "utf8");
  const dry = await promisify(execFile)(
    process.execPath,
    ["scripts/a15-mark-openings.ts", folder],
    { env: fixture.env },
  );
  assert.match(dry.stdout, /Sliding glass door/);
  assert.match(dry.stdout, /Open doorway with wood frame/);
  assert.match(dry.stdout, /Dry run: 2 wall openings/);
  assert.doesNotMatch(dry.stdout, /Curtain/);
  assert.equal(readFileSync(join(folder, "project.json"), "utf8"), before);
  const opened = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: saved.id }),
  );
  assert.ok(opened.scene.items.every((item) => item.cutsOpening === undefined));
  await promisify(execFile)(
    process.execPath,
    ["scripts/a15-mark-openings.ts", folder, "--apply"],
    { env: fixture.env },
  );
  const marked = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: saved.id }),
  );
  assert.equal(marked.scene.items.filter((item) => item.cutsOpening).length, 2);
  assert.equal(marked.revision, 2);
  assert.ok(
    marked.scene.items
      .filter((item) => item.name.startsWith("Curtain"))
      .every((item) => item.cutsOpening === undefined),
  );
  const repeated = await promisify(execFile)(
    process.execPath,
    ["scripts/a15-mark-openings.ts", folder, "--apply"],
    { env: fixture.env },
  );
  assert.match(repeated.stdout, /Applied 0/);
  const explicitFalse = marked.scene.items.find((item) => item.cutsOpening);
  assert.ok(explicitFalse);
  await daemon.command({
    type: "scene.apply",
    projectId: saved.id,
    command: {
      type: "item.update",
      itemId: explicitFalse.id,
      patch: { cutsOpening: false },
    },
  });
  const preservesFalse = await promisify(execFile)(
    process.execPath,
    ["scripts/a15-mark-openings.ts", folder, "--apply"],
    { env: fixture.env },
  );
  assert.match(preservesFalse.stdout, /Applied 0/);
  const afterFalse = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: saved.id }),
  );
  assert.equal(
    afterFalse.scene.items.find((item) => item.id === explicitFalse.id)
      ?.cutsOpening,
    false,
  );
  await daemon.stop();
  process.stdout.write(
    "Copied project: dry-run unchanged, explicit apply and repeated apply verified.\n",
  );

  async function run(args: string[]) {
    const child = spawn("pnpm", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        PLANNER_PORT: fixture.env.PLANNER_PORT,
        PLANNER_WEB_PORT: fixture.env.PLANNER_WEB_PORT,
        PLANNER_HOME: fixture.env.PLANNER_HOME,
        PLANNER_PROJECTS: fixture.env.PLANNER_PROJECTS,
      },
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `pnpm ${args.join(" ")} failed`);
  }
  await run([
    "exec",
    "vitest",
    "run",
    "packages/shared/src/commands/item-openings.test.ts",
    "test/integration/a15-opening-names.test.ts",
    "packages/daemon/src/generation/get-generation-target-size.test.ts",
    "packages/daemon/src/generation/generation-recovery.test.ts",
    "packages/shared/src/inventory/inventory-contracts.test.ts",
    "apps/web/src/editor/scene/wall-openings.test.ts",
    "apps/web/src/editor/scene/create-wall-geometry.test.ts",
  ]);
  await run([
    "exec",
    "playwright",
    "test",
    "-c",
    "apps/web/playwright.config.ts",
    "e2e/wall-openings.spec.ts",
    "--project=chromium-earlier",
    "--no-deps",
    "--workers=1",
  ]);
  process.stdout.write(
    "gate:a15 passed: schema and inverses, inventory, copied-project script, wall holes, clamped depth, flush placements, Blueprint and inspector undo.\n",
  );
} finally {
  clearInterval(progress);
  await fixture.close();
}
