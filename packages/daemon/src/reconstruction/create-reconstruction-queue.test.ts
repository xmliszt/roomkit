import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { readModelRegistry } from "../preflight/read-model-registry.ts";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { createReconstructionQueue } from "./create-reconstruction-queue.ts";

test("a managed Python installed after queue creation is used by the next job", async () => {
  const fixture = await createTestFixture();
  const registry = readModelRegistry(undefined);
  registry.models = registry.models.map((model) => ({
    ...model,
    files: [{ path: "fixture.safetensors", sizeBytes: 4 }],
  }));
  const queue = createReconstructionQueue({
    store: fixture.daemon.store,
    chat: fixture.daemon.chat,
    bus: fixture.daemon.bus,
    logger: createLogger("test"),
    plannerHome: fixture.env.PLANNER_HOME,
    pythonProjectDir: join(fixture.root, "development-python"),
    registry,
    env: {
      ...fixture.env,
      B6_CONTROL: join(fixture.root, "control.json"),
      B6_CALLS: join(fixture.root, "calls.jsonl"),
    },
  });
  try {
    writeJson({
      path: join(fixture.root, "control.json"),
      value: { mode: "normal" },
    });
    const managedBin = join(fixture.env.PLANNER_HOME, "python", ".venv", "bin");
    mkdirSync(managedBin, { recursive: true });
    symlinkSync(
      resolve("scripts/b6/fake-python.mjs"),
      join(managedBin, "python"),
    );
    for (const model of registry.models) {
      const folder = join(
        fixture.env.PLANNER_HOME,
        "python",
        "weights",
        model.folder,
      );
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "fixture.safetensors"), "data");
      writeJson({
        path: join(folder, ".complete.json"),
        value: { revision: model.revision },
      });
    }
    const project = fixture.daemon.store.createProject({
      name: "Installed Python",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    const photosDir = join(
      fixture.daemon.store.projectPath(project.id),
      "photos",
    );
    for (const subdir of ["upright", "vision"])
      mkdirSync(join(photosDir, subdir));
    const photos = ["one", "two"].map((photoId) => ({
      photoId,
      origin: "capture",
      sourceFileName: `${photoId}.jpg`,
      widthPx: 80,
      heightPx: 120,
      orientation: 1,
      blurScore: 100,
      kind: "accepted",
      uprightPath: `upright/${photoId}.jpg`,
      visionPath: `vision/${photoId}.jpg`,
      visionWidthPx: 80,
      visionHeightPx: 120,
    }));
    for (const photo of photos)
      for (const relative of [
        photo.sourceFileName,
        photo.uprightPath,
        photo.visionPath,
      ])
        writeFileSync(join(photosDir, relative), "fake photo");
    writeJson({
      path: join(photosDir, "photos.json"),
      value: { version: 1, photos },
    });
    queue.start(project.id);
    await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("done"), {
      timeout: 5000,
    });
    expect(
      fixture.daemon.store.loadProject(project.id).scene.room.ceilingHeightM,
    ).toBe(2.7);
  } finally {
    await queue.stopAll();
    await fixture.close();
  }
});

test("cancelling reconstruction waiting for a worker prevents execution and persists after recovery", async () => {
  const fixture = await createTestFixture();
  const workerSlots = createTurnSlots({ size: 1 });
  const release = await workerSlots.acquire(new AbortController().signal);
  const project = fixture.daemon.store.createProject({
    name: "Queued room",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  const folder = fixture.daemon.store.projectPath(project.id);
  const now = new Date().toISOString();
  writeJson({
    path: join(folder, ".planner", "jobs.json"),
    value: [
      {
        job: {
          id: "queued-reconstruction",
          kind: "reconstruction",
          projectId: project.id,
          stage: "queued",
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
        photoIds: ["one", "two"],
        sources: [],
        outcome: {
          command: { type: "room.update", ceilingHeightM: 3 },
          undo: { type: "room.update", ceilingHeightM: 2.6 },
          weakScale: false,
          blocks: [],
        },
      },
    ],
  });
  function createQueue() {
    return createReconstructionQueue({
      store: fixture.daemon.store,
      chat: fixture.daemon.chat,
      bus: fixture.daemon.bus,
      logger: createLogger("test"),
      plannerHome: fixture.env.PLANNER_HOME,
      pythonProjectDir: join(fixture.root, "no-python"),
      registry: readModelRegistry(undefined),
      env: fixture.env,
      workerSlots,
    });
  }
  let queue = createQueue();
  try {
    await queue.resume();
    expect(
      queue.cancel({ projectId: project.id, jobId: "queued-reconstruction" }),
    ).toEqual({ jobId: "queued-reconstruction", stage: "cancelled" });
    release?.();
    await vi.waitFor(() =>
      expect(readProjectJobRecords(folder).at(0)?.job.stage).toBe("cancelled"),
    );
    await queue.stopAll();
    queue = createQueue();
    await queue.resume();
    await queue.stopAll();
    expect(queue.list().at(0)?.stage).toBe("cancelled");
    expect(
      fixture.daemon.store.loadProject(project.id).scene.room.ceilingHeightM,
    ).toBe(2.6);
    expect(fixture.daemon.chat.list(project.id)).toEqual([]);
  } finally {
    await queue.stopAll();
    await fixture.close();
  }
});
