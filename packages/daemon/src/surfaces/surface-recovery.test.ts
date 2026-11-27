import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { JobRecordSchema } from "../reconstruction/job-record-schema.ts";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { createSurfaceQueue } from "./create-surface-queue.ts";
import type { SurfaceRecord } from "./surface-record-schema.ts";

for (const state of ["unapplied", "applied", "changed", "unpersisted"]) {
  test(`recovers a prepared surface when ${state}`, async () => {
    const fixture = await createTestFixture();
    const { store, chat, bus } = fixture.daemon;
    const project = store.createProject({
      name: "surface recovery",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    });
    const assetId = randomUUID();
    const now = new Date().toISOString();
    const record: SurfaceRecord = {
      job: {
        id: randomUUID(),
        kind: "surface",
        projectId: project.id,
        surfaceId: "floor",
        stage: "generating",
        progress: 0.8,
        createdAt: now,
        updatedAt: now,
      },
      room: structuredClone(project.scene.room),
      photoIds: [],
      prompt: "Light oak",
      assetId,
      attempt: 0,
      outcome: {
        kind: "prepared",
        command: {
          type: "surface.update",
          surfaceId: "floor",
          color: "#ccaa88",
          material: {
            kind: "planks",
            plankSizeM: { u: 0.2, v: 1.2 },
            baseColor: "#ccaa88",
            roughness: 0.5,
            textureAssetId: assetId,
          },
        },
        block: {
          kind: "diff",
          changes: [
            { label: "floor material", before: "flat", after: "planks" },
          ],
          undo: [{ type: "surface.update", surfaceId: "floor", color: null }],
        },
      },
    };
    const queue = createSurfaceQueue({
      store,
      chat,
      bus,
      logger: createLogger(),
      runtime: createAgentRuntime({ env: fixture.env }),
      config: createDefaultConfig,
      env: fixture.env,
      plannerHome: join(fixture.root, "planner"),
      agentSlots: createTurnSlots({ size: 2 }),
      workerSlots: createTurnSlots({ size: 1 }),
      link: () => ({ wsUrl: "ws://127.0.0.1:9", token: "unused" }),
    });
    try {
      if (state === "applied" && record.outcome)
        store.applyCommand({
          projectId: project.id,
          command: record.outcome.command,
          requestId: undefined,
        });
      if (state === "changed")
        store.applyCommand({
          projectId: project.id,
          command: {
            type: "surface.update",
            surfaceId: "floor",
            color: "#123456",
          },
          requestId: undefined,
        });
      if (state === "unpersisted" && record.outcome)
        record.outcome = { ...record.outcome, kind: "applied", revision: 1 };
      const revision = store.loadProject(project.id).revision;
      writeProjectJobRecords({
        folder: store.projectPath(project.id),
        kind: "surface",
        records: [record],
      });
      await queue.resume();
      await vi.waitFor(() =>
        expect(queue.list().at(0)?.stage).toBe(
          state === "changed" ? "failed" : "ready",
        ),
      );
      expect(store.loadProject(project.id).revision).toBe(
        revision + (["unapplied", "unpersisted"].includes(state) ? 1 : 0),
      );
      if (state === "changed")
        expect(
          store.loadProject(project.id).scene.room.surfaces.floor?.color,
        ).toBe("#123456");
      else
        expect(
          chat
            .list(project.id)
            .find((message) => message.id === record.job.id)
            ?.blocks.filter((block) => block.kind === "diff"),
        ).toHaveLength(1);
    } finally {
      await queue.stopAll();
      await fixture.close();
    }
  });
}

test("queues a new reconstruction surface after an earlier job finishes", async () => {
  const fixture = await createTestFixture();
  const { store, chat, bus } = fixture.daemon;
  const project = store.createProject({
    name: "overlapping reconstruction",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
  });
  const queue = createSurfaceQueue({
    store,
    chat,
    bus,
    logger: createLogger(),
    runtime: createAgentRuntime({ env: fixture.env }),
    config: createDefaultConfig,
    env: fixture.env,
    plannerHome: join(fixture.root, "planner"),
    agentSlots: createTurnSlots({ size: 2 }),
    workerSlots: createTurnSlots({ size: 1 }),
    link: () => ({ wsUrl: "ws://127.0.0.1:9", token: "unused" }),
  });
  try {
    const first = queue.start({
      projectId: project.id,
      target: { kind: "surface", surfaceId: "floor" },
      prompt: "oak",
    });
    writeJson({
      path: join(store.projectPath(project.id), "photos", "photos.json"),
      value: {
        version: 1,
        photos: ["photo-1", "photo-2", "rejected", "chat", "later"].map(
          (photoId) => ({
            photoId,
            origin: photoId === "chat" ? "chat" : "capture",
            sourceFileName: `${photoId}.jpg`,
            widthPx: 10,
            heightPx: 10,
            orientation: 1,
            blurScore: 100,
            ...(photoId === "rejected"
              ? { kind: "rejected", reason: "blur" }
              : {
                  kind: "accepted",
                  uprightPath: `upright/${photoId}.jpg`,
                  visionPath: `vision/${photoId}.jpg`,
                  visionWidthPx: 10,
                  visionHeightPx: 10,
                }),
          }),
        ),
      },
    });
    const reconstructionJobId = randomUUID();
    const at = new Date().toISOString();
    store.applyCommand({
      projectId: project.id,
      requestId: undefined,
      command: { type: "room.update", ceilingHeightM: 3 },
      reconstruction: { jobId: reconstructionJobId, weakScale: false },
    });
    writeProjectJobRecords({
      folder: store.projectPath(project.id),
      kind: "reconstruction",
      records: [
        JobRecordSchema.parse({
          job: {
            id: reconstructionJobId,
            kind: "reconstruction",
            projectId: project.id,
            stage: "done",
            progress: 1,
            createdAt: at,
            updatedAt: at,
          },
          photoIds: ["photo-1", "photo-2", "rejected", "chat"],
          sources: [],
        }),
      ],
    });
    queue.autoStart(project.id);
    await vi.waitFor(() =>
      expect(
        queue.list().filter((job) => job.surfaceId === "floor"),
      ).toHaveLength(2),
    );
    const records = readProjectJobRecords(store.projectPath(project.id)).filter(
      (record) =>
        record.job.kind === "surface" &&
        record.reconstructionJobId === reconstructionJobId,
    );
    expect(records).toHaveLength(6);
    for (const record of records)
      expect(record.photoIds).toEqual(["photo-1", "photo-2"]);
    expect(
      records.find((record) => record.job.surfaceId === "floor")?.job.id,
    ).not.toBe(first.jobIds.at(0));
  } finally {
    await queue.stopAll();
    await fixture.close();
  }
});

test("resumes an applied surface's undo publication after another project cannot flush", async () => {
  const fixture = await createTestFixture({ writeDelayMs: 60000 });
  const { store, chat, bus } = fixture.daemon;
  const project = store.createProject({
    name: "surface publication",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
  });
  const other = store.createProject({
    name: "unwritable",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
  });
  const otherPath = join(store.projectPath(other.id), "project.json");
  const at = new Date().toISOString();
  const record: SurfaceRecord = {
    job: {
      id: randomUUID(),
      kind: "surface",
      projectId: project.id,
      surfaceId: "floor",
      stage: "generating",
      progress: 0.8,
      createdAt: at,
      updatedAt: at,
    },
    room: structuredClone(project.scene.room),
    photoIds: [],
    prompt: "sage paint",
    assetId: randomUUID(),
    attempt: 0,
    outcome: {
      kind: "prepared",
      command: {
        type: "surface.update",
        surfaceId: "floor",
        color: "#9cae92",
        material: { kind: "paint", color: "#9cae92", finish: "matte" },
      },
      block: {
        kind: "diff",
        changes: [{ label: "floor material", before: "flat", after: "paint" }],
        undo: [{ type: "surface.update", surfaceId: "floor", color: null }],
      },
    },
  };
  function buildQueue() {
    return createSurfaceQueue({
      store,
      chat,
      bus,
      logger: createLogger(),
      runtime: createAgentRuntime({ env: fixture.env }),
      config: createDefaultConfig,
      env: fixture.env,
      plannerHome: join(fixture.root, "planner"),
      agentSlots: createTurnSlots({ size: 2 }),
      workerSlots: createTurnSlots({ size: 1 }),
      link: () => ({ wsUrl: "ws://127.0.0.1:9", token: "unused" }),
    });
  }
  const first = buildQueue();
  const restarted = buildQueue();
  try {
    store.applyCommand({
      projectId: other.id,
      requestId: undefined,
      command: { type: "surface.update", surfaceId: "floor", color: "#ffffff" },
    });
    rmSync(otherPath);
    mkdirSync(otherPath);
    writeProjectJobRecords({
      folder: store.projectPath(project.id),
      kind: "surface",
      records: [record],
    });
    await first.resume();
    await vi.waitFor(() => expect(first.list().at(0)?.stage).toBe("failed"));
    expect(
      store.loadProject(project.id).scene.room.surfaces.floor?.material?.kind,
    ).toBe("paint");
    store.applyCommand({
      projectId: project.id,
      requestId: undefined,
      command: { type: "surface.update", surfaceId: "floor", color: "#123456" },
    });
    const revision = store.loadProject(project.id).revision;
    await first.stopAll();
    rmSync(otherPath, { recursive: true });
    writeJson({ path: otherPath, value: store.loadProject(other.id) });
    store.flush();
    await restarted.resume();
    await vi.waitFor(() => expect(restarted.list().at(0)?.stage).toBe("ready"));
    expect(store.loadProject(project.id).revision).toBe(revision);
    expect(store.loadProject(project.id).scene.room.surfaces.floor?.color).toBe(
      "#123456",
    );
    const diff = chat
      .list(project.id)
      .find((message) => message.id === record.job.id)
      ?.blocks.find((block) => block.kind === "diff");
    expect(diff?.kind).toBe("diff");
    if (diff?.kind !== "diff") throw new Error("Missing recovered undo");
    for (const command of diff.undo)
      store.applyCommand({
        projectId: project.id,
        requestId: undefined,
        command,
      });
    expect(store.loadProject(project.id).scene.room.surfaces).toEqual(
      project.scene.room.surfaces,
    );
  } finally {
    await first.stopAll();
    await restarted.stopAll();
    rmSync(otherPath, { recursive: true, force: true });
    writeJson({ path: otherPath, value: store.loadProject(other.id) });
    await fixture.close();
  }
});
