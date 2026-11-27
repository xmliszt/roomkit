import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { SurfaceAssetMetaSchema } from "@planner/shared/src/scene/surface-asset-meta-schema.ts";
import { checkSurfaceTextures } from "../packages/daemon/src/surfaces/check-surface-textures.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture();
const progress = setInterval(
  () => process.stdout.write("B15 surface gate running\n"),
  5000,
);
try {
  let daemon = await fixture.start();
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      modeler: { cli: "claude", model: "fake-surfaces" },
    },
  });
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "B15 surfaces",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    }),
  );
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "surface.update", surfaceId: "floor", color: "#ffffff" },
  });
  const before = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  ).scene.room.surfaces;
  const bytes = readFileSync(
    new URL("../packages/daemon/test/fixtures/oriented.heic", import.meta.url),
  );
  for (let index = 0; index < 2; index++) {
    const uploaded = await fetch(
      `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=capture.heic&origin=capture`,
      { method: "POST", headers: { origin: fixture.origin }, body: bytes },
    );
    assert.equal(uploaded.status, 201, await uploaded.text());
  }
  await daemon.command({ type: "reconstruction.start", projectId: project.id });
  const jobs = await daemon.waitFor({
    label: "all automatic surface jobs",
    timeoutMs: 180000,
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
      return jobs.length === 6 &&
        jobs.every((job) => ["ready", "failed"].includes(job.stage))
        ? jobs
        : undefined;
    },
  });
  for (const job of jobs) assert.equal(job.stage, "ready", job.error);
  process.stdout.write(
    "B15 automatic floor, walls and ceiling completed with real Blender\n",
  );
  const result = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.equal(result.scene.room.surfaces.floor?.material?.kind, "tiles");
  for (const job of jobs) {
    const material = result.scene.room.surfaces[job.surfaceId]?.material;
    assert.ok(material && material.kind !== "paint" && material.textureAssetId);
    const folder = join(
      fixture.root,
      "projects",
      project.id,
      "assets",
      material.textureAssetId,
    );
    assert.ok(existsSync(join(folder, "baseColor.png")));
    const meta = SurfaceAssetMetaSchema.parse(
      JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")),
    );
    assert.deepEqual(meta.material, material);
    assert.equal(meta.provenance.sourcePhotoIds.length, 2);
    await checkSurfaceTextures({
      folder: join(
        fixture.root,
        "projects",
        project.id,
        ".planner",
        "surfaces",
        job.id,
      ),
      assetId: material.textureAssetId,
    });
    for (const file of [
      "baseColor.png",
      "normal.png",
      "roughness.png",
      "meta.json",
    ]) {
      const response: Response = await fetch(
        `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/assets/${material.textureAssetId}/${file}`,
        { headers: { origin: fixture.origin } },
      );
      assert.equal(response.status, 200);
    }
  }
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  for (const job of jobs) {
    const message = history.messages.find((message) => message.id === job.id);
    const diff = message?.blocks.find((block) => block.kind === "diff");
    assert.ok(diff?.kind === "diff");
    assert.equal(diff.undo.length, 1);
    for (const command of diff.undo)
      await daemon.command({
        type: "scene.apply",
        projectId: project.id,
        command,
      });
  }
  assert.deepEqual(
    ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    ).scene.room.surfaces,
    before,
  );
  await daemon.stop();
  daemon = await fixture.start();
  assert.deepEqual(
    ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    ).scene.room.surfaces,
    before,
  );
  const snapshot = daemon.frames.find((frame) => frame.type === "snapshot");
  assert.ok(snapshot?.type === "snapshot");
  assert.equal(snapshot.jobs.filter((job) => job.kind === "surface").length, 6);
  await assert.rejects(
    daemon.command({
      type: "agent.surface.set",
      projectId: project.id,
      turnId: crypto.randomUUID(),
      target: { kind: "surface", surfaceId: "floor" },
      prompt: "not authorized",
    }),
    /Only an agent/,
  );
  await daemon.command({
    type: "chat.send",
    projectId: project.id,
    text: "[fake:surface-request] non-tileable",
  });
  const failed = await daemon.waitFor({
    label: "non-tileable surface rejection",
    timeoutMs: 90000,
    read: () =>
      daemon.frames
        .flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.kind === "surface" &&
          frame.event.job.stage === "failed"
            ? [frame.event.job]
            : [],
        )
        .at(-1),
  });
  assert.match(failed.error ?? "", /not tileable/);
  assert.deepEqual(
    ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    ).scene.room.surfaces,
    before,
  );
  const records = JSON.parse(
    readFileSync(
      join(fixture.root, "projects", project.id, ".planner", "jobs.json"),
      "utf8",
    ),
  );
  assert.equal(
    records.find(
      (record: { job: { id: string } }) => record.job.id === failed.id,
    ).attempt,
    2,
  );
  async function paint(input: { target: string; expected: number }) {
    const countBefore = daemon.frames.filter(
      (frame) => frame.type === "event" && frame.event.kind === "job.updated",
    ).length;
    const startIndex = daemon.frames.length;
    await daemon.command({
      type: "chat.send",
      projectId: project.id,
      text: `[fake:surface-request] sage ${input.target}`,
    });
    const ready = await daemon.waitFor({
      label: "paint jobs",
      timeoutMs: 120000,
      read() {
        const completed = daemon.frames
          .slice(startIndex)
          .flatMap((frame) =>
            frame.type === "event" &&
            frame.event.kind === "job.updated" &&
            frame.event.job.kind === "surface" &&
            ["ready", "failed"].includes(frame.event.job.stage)
              ? [frame.event.job]
              : [],
          );
        return completed.length === input.expected ? completed : undefined;
      },
    });
    for (const job of ready) assert.equal(job.stage, "ready", job.error);
    assert.ok(
      daemon.frames.filter(
        (frame) => frame.type === "event" && frame.event.kind === "job.updated",
      ).length > countBefore,
    );
    const painted = ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
    for (const job of ready)
      assert.deepEqual(painted.scene.room.surfaces[job.surfaceId]?.material, {
        kind: "paint",
        color: "#9cae92",
        finish: "matte",
      });
    assert.deepEqual(painted.scene.room.surfaces.floor, before.floor);
    const history = ChatHistoryResultSchema.parse(
      await daemon.command({ type: "chat.history", projectId: project.id }),
    );
    for (const job of ready) {
      const diff = history.messages
        .find((message) => message.id === job.id)
        ?.blocks.find((block) => block.kind === "diff");
      assert.ok(diff?.kind === "diff");
      for (const command of diff.undo)
        await daemon.command({
          type: "scene.apply",
          projectId: project.id,
          command,
        });
    }
    assert.deepEqual(
      ProjectSchema.parse(
        await daemon.command({ type: "project.open", projectId: project.id }),
      ).scene.room.surfaces,
      before,
    );
  }
  await paint({
    target: `wall:${result.scene.room.walls.at(0)?.id}`,
    expected: 1,
  });
  await paint({
    target: "all walls",
    expected: result.scene.room.walls.length,
  });
  const cancellationProject = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "B15 cancellation",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    }),
  );
  await daemon.command({
    type: "chat.send",
    projectId: cancellationProject.id,
    text: "[fake:surface-request] all walls",
  });
  function cancellationJobs() {
    return Object.values(
      Object.fromEntries(
        daemon.frames.flatMap((frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.kind === "surface" &&
          frame.event.job.projectId === cancellationProject.id
            ? [[frame.event.job.id, frame.event.job]]
            : [],
        ),
      ),
    );
  }
  const queued = await daemon.waitFor({
    label: "surface waiting for a modeler slot",
    read() {
      const jobs = cancellationJobs();
      return jobs.filter((job) => job.stage === "generating").length === 2
        ? jobs.find((job) => job.stage === "queued")
        : undefined;
    },
  });
  const runningJob = cancellationJobs().find(
    (job) => job.stage === "generating",
  );
  assert.ok(runningJob);
  await assert.rejects(
    daemon.command({
      type: "job.cancel",
      projectId: cancellationProject.id,
      jobId: runningJob.id,
    }),
    /Only queued jobs/,
  );
  assert.deepEqual(
    await daemon.command({
      type: "job.cancel",
      projectId: cancellationProject.id,
      jobId: queued.id,
    }),
    { jobId: queued.id, stage: "cancelled" },
  );
  const completed = await daemon.waitFor({
    label: "uncancelled wall surfaces",
    timeoutMs: 120000,
    read() {
      const jobs = cancellationJobs();
      return jobs.length === 4 &&
        jobs.every((job) =>
          ["ready", "failed", "cancelled"].includes(job.stage),
        )
        ? jobs
        : undefined;
    },
  });
  for (const job of completed)
    assert.equal(
      job.stage,
      job.id === queued.id ? "cancelled" : "ready",
      job.error,
    );
  const readyJob = completed.find((job) => job.stage === "ready");
  assert.ok(readyJob);
  await assert.rejects(
    daemon.command({
      type: "job.cancel",
      projectId: cancellationProject.id,
      jobId: readyJob.id,
    }),
    /Only queued jobs/,
  );
  await daemon.stop();
  daemon = await fixture.start();
  const restartedSnapshot = daemon.frames.find(
    (frame) => frame.type === "snapshot",
  );
  assert.ok(restartedSnapshot?.type === "snapshot");
  assert.equal(
    restartedSnapshot.jobs.find((job) => job.id === queued.id)?.stage,
    "cancelled",
  );
  assert.equal(
    ProjectSchema.parse(
      await daemon.command({
        type: "project.open",
        projectId: cancellationProject.id,
      }),
    ).scene.room.surfaces[queued.surfaceId],
    undefined,
  );
  await daemon.stop();
  process.stdout.write(
    "gate:b15 passed: fake reconstruction, six real-Blender texture jobs, seam and size checks, served textures, inverse restores flat colour, restart preserves undo, designer surface_set, unauthorized command refused, non-tileable output rejected after retry, single-wall and all-wall paint undo, queued cancellation persists across restart\n",
  );
} finally {
  clearInterval(progress);
  await fixture.close();
}
