import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { AgentRunResult } from "../agent/run-options.ts";
import { createChatStore } from "../chat/create-chat-store.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { createProjectStore } from "../project/create-project-store.ts";
import * as reconstructionRequirements from "../reconstruction/check-reconstruction-requirements.ts";
import type { JobRecord } from "../reconstruction/job-record-schema.ts";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { EventBus } from "../ws/event-bus.ts";
import { createInventoryQueue } from "./create-inventory-queue.ts";
import type { InventoryRecord } from "./inventory-record-schema.ts";
import * as inventoryMeasurement from "./run-inventory-measurement.ts";

function buildItem(options: { id: string }) {
  return {
    id: options.id,
    name: options.id,
    model: { kind: "pending", jobId: `generation-${options.id}` },
    placement: {
      kind: "floor",
      xM: 0,
      zM: 0,
      elevationM: 0,
      rotationRad: 0,
    },
    sizeM: { width: 1.2, height: 0.8, depth: 0.6 },
    locked: false,
  } satisfies Item;
}

async function buildPreparedFixture(
  options: {
    appliedItemIds?: string[];
    removedItemIds?: string[];
    changedRoom?: boolean;
  } = {},
) {
  const fixture = await createTestFixture({
    env: (root) => ({ PLANNER_PYTHON_BIN: join(root, "no-worker") }),
  });
  const store = fixture.daemon.store;
  const project = store.createProject({
    name: "Inventory recovery",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
  });
  const folder = store.projectPath(project.id);
  const reconstructionJobId = randomUUID();
  const inventoryJobId = randomUUID();
  store.applyCommand({
    projectId: project.id,
    command: { type: "room.update", ceilingHeightM: 2.8 },
    requestId: undefined,
    reconstruction: { jobId: reconstructionJobId, weakScale: false },
  });
  const items = [buildItem({ id: "sofa" }), buildItem({ id: "desk" })];
  const at = "2026-11-23T00:00:00Z";
  const outcomeBlocks: NonNullable<InventoryRecord["outcome"]>["blocks"] = [];
  const reconstruction = {
    artifacts: {
      scenePath: join(folder, "recon", "scene.npz"),
      camerasPath: join(folder, "recon", "cameras.json"),
    },
    job: {
      id: reconstructionJobId,
      kind: "reconstruction",
      projectId: project.id,
      stage: "done",
      progress: 1,
      createdAt: at,
      updatedAt: at,
    },
    photoIds: ["photo-1", "photo-2"],
    sources: [],
  } satisfies JobRecord;
  const record = {
    job: {
      id: inventoryJobId,
      kind: "inventory",
      projectId: project.id,
      reconstructionJobId,
      stage: "applying",
      progress: 0.95,
      createdAt: at,
      updatedAt: at,
    },
    photoIds: ["photo-1", "photo-2"],
    scenePath: join(folder, "recon", "scene.npz"),
    camerasPath: join(folder, "recon", "cameras.json"),
    room: structuredClone(store.loadProject(project.id).scene.room),
    outcome: {
      blockStartIndex: 1,
      items,
      generationJobs: items.map((item) => ({
        id: item.model.jobId,
        kind: "generation",
        projectId: project.id,
        itemId: item.id,
        stage: "queued",
        progress: 0,
        createdAt: at,
        updatedAt: at,
      })),
      undo: items
        .toReversed()
        .map((item) => ({ type: "item.remove", itemId: item.id })),
      blocks: outcomeBlocks,
    },
  } satisfies InventoryRecord;
  writeFileSync(reconstruction.artifacts.scenePath, "points");
  writeFileSync(reconstruction.artifacts.camerasPath, "[]");
  writeJson({
    path: join(folder, "recon", "room.json"),
    value: reconstruction.artifacts,
  });
  for (const [index, itemId] of (options.appliedItemIds ?? []).entries()) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`Unknown fixture item ${itemId}`);
    store.applyCommand({
      projectId: project.id,
      command: { type: "item.add", item },
      requestId: undefined,
      inventory: {
        jobId: inventoryJobId,
        appliedItemIds: (options.appliedItemIds ?? []).slice(0, index + 1),
      },
    });
  }
  for (const itemId of options.removedItemIds ?? [])
    store.applyCommand({
      projectId: project.id,
      command: { type: "item.remove", itemId },
      requestId: undefined,
    });
  if (options.changedRoom)
    store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 3 },
      requestId: undefined,
    });
  store.flush();
  writeJson({
    path: join(folder, ".planner", "jobs.json"),
    value: [reconstruction, record],
  });
  return { fixture, folder, projectId: project.id, record, reconstruction };
}

function createRecoveredQueue(options: {
  fixture: Awaited<ReturnType<typeof createTestFixture>>;
}) {
  const bus = new EventBus();
  const events: PlannerEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const logger = createLogger("test");
  const store = createProjectStore({
    projectsRoot: options.fixture.env.PLANNER_PROJECTS,
    catalogRoot: join(options.fixture.root, "catalog"),
    catalogAssetIds: new Set(),
    bus,
    logger,
    writeDelayMs: 0,
  });
  const chat = createChatStore({ bus, projectPath: store.projectPath });
  const runtime = createAgentRuntime({ env: options.fixture.env });
  const runTurn = vi.spyOn(runtime, "runTurn").mockImplementation(async () => {
    throw new Error("Prepared inventory must not run an agent");
  });
  const queue = createInventoryQueue({
    store,
    chat,
    bus,
    logger,
    plannerHome: options.fixture.env.PLANNER_HOME,
    pythonProjectDir: join(options.fixture.root, "no-python-project"),
    registry: { baseUrl: "https://example.invalid", models: [] },
    env: options.fixture.env,
    runtime,
    config: createDefaultConfig,
    link: () => ({ wsUrl: "ws://127.0.0.1:9/ws", token: "unused" }),
    rolePromptPath: resolve("roles/surveyor.md"),
    workerSlots: createTurnSlots({ size: 1 }),
    agentSlots: createTurnSlots({ size: 2 }),
    linkAllowedHosts: [],
  });
  return { queue, store, chat, runTurn, events };
}

async function waitForInventory(options: {
  queue: ReturnType<typeof createInventoryQueue>;
  stage: "done" | "failed";
}) {
  await vi.waitFor(() => {
    expect(
      options.queue.list().find((job) => job.kind === "inventory")?.stage,
    ).toBe(options.stage);
  });
}

test("restart never re-adds a receipted item removed before completion", async () => {
  const input = await buildPreparedFixture({
    appliedItemIds: ["sofa", "desk"],
    removedItemIds: ["sofa"],
  });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    expect(
      recovered.store
        .loadProject(input.projectId)
        .scene.items.map((item) => item.id),
    ).toEqual(["desk"]);
    expect(
      recovered.events.filter((event) => event.kind === "scene.changed"),
    ).toEqual([]);
    expect(recovered.queue.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generation-sofa", stage: "failed" }),
        expect.objectContaining({ id: "generation-desk", stage: "queued" }),
      ]),
    );
    expect(recovered.runTurn).not.toHaveBeenCalled();
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("restart applies only items missing from the persisted receipt", async () => {
  const input = await buildPreparedFixture({ appliedItemIds: ["sofa"] });
  const recovered = createRecoveredQueue(input);
  try {
    const revision = recovered.store.loadProject(input.projectId).revision;
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    const project = recovered.store.loadProject(input.projectId);
    expect(project.scene.items.map((item) => item.id)).toEqual([
      "sofa",
      "desk",
    ]);
    expect(project.revision).toBe(revision + 1);
    expect(project.inventory).toEqual({
      jobId: input.record.job.id,
      appliedItemIds: ["sofa", "desk"],
    });
    expect(
      JSON.parse(readFileSync(join(input.folder, "project.json"), "utf8")),
    ).toEqual(project);
    expect(
      recovered.chat
        .list(input.projectId)
        .flatMap((message) => message.blocks)
        .filter((block) => block.kind === "diff"),
    ).toEqual([
      expect.objectContaining({
        undo: [
          { type: "item.remove", itemId: "desk" },
          { type: "item.remove", itemId: "sofa" },
        ],
      }),
    ]);
    expect(recovered.runTurn).not.toHaveBeenCalled();
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("queued jobs and cancelled removed jobs keep their state on a second restart", async () => {
  const input = await buildPreparedFixture({
    appliedItemIds: ["sofa", "desk"],
    removedItemIds: ["sofa"],
  });
  const first = createRecoveredQueue(input);
  const second = createRecoveredQueue(input);
  try {
    first.queue.resume();
    await waitForInventory({ queue: first.queue, stage: "done" });
    await first.queue.stopAll();
    const savedJobs = first.queue.list();
    second.queue.resume();
    await waitForInventory({ queue: second.queue, stage: "done" });
    expect(second.queue.list()).toEqual(savedJobs);
    expect(
      second.store
        .loadProject(input.projectId)
        .scene.items.map((item) => item.id),
    ).toEqual(["desk"]);
    expect(
      second.events.filter((event) => event.kind === "scene.changed"),
    ).toEqual([]);
    expect(second.runTurn).not.toHaveBeenCalled();
  } finally {
    await first.queue.stopAll();
    await second.queue.stopAll();
    first.store.flush();
    second.store.flush();
    await input.fixture.close();
  }
});

test("a changed room rejects a prepared outcome without inserting items", async () => {
  const input = await buildPreparedFixture({ changedRoom: true });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "failed" });
    expect(recovered.store.loadProject(input.projectId).scene.items).toEqual(
      [],
    );
    expect(
      recovered.store.loadProject(input.projectId).inventory,
    ).toBeUndefined();
    expect(
      recovered.events.filter((event) => event.kind === "scene.changed"),
    ).toEqual([]);
    expect(recovered.queue.list()).toContainEqual(
      expect.objectContaining({
        kind: "inventory",
        error: expect.stringContaining("room changed"),
      }),
    );
    expect(recovered.runTurn).not.toHaveBeenCalled();
    const retry = recovered.queue.start(input.projectId);
    expect(retry.jobId).not.toBe(input.record.job.id);
    const retriedRecord = readProjectJobRecords(input.folder).find(
      (record) => record.job.id === retry.jobId,
    );
    expect(retriedRecord?.room).toEqual(
      recovered.store.loadProject(input.projectId).scene.room,
    );
    expect(retriedRecord?.outcome).toBeUndefined();
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("partial inventory application requires restoring its room before retry", async () => {
  const input = await buildPreparedFixture({
    changedRoom: true,
    appliedItemIds: ["sofa"],
  });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "failed" });
    expect(() => recovered.queue.start(input.projectId)).toThrow(
      "Restore its room dimensions",
    );
    recovered.store.applyCommand({
      projectId: input.projectId,
      command: { type: "room.update", ceilingHeightM: 2.8 },
      requestId: undefined,
    });
    recovered.store.applyCommand({
      projectId: input.projectId,
      requestId: undefined,
      command: {
        type: "surface.update",
        surfaceId: "floor",
        color: "#ffffff",
        material: { kind: "paint", color: "#ffffff", finish: "matte" },
      },
    });
    expect(recovered.queue.start(input.projectId)).toEqual({
      jobId: input.record.job.id,
    });
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    expect(
      recovered.store
        .loadProject(input.projectId)
        .scene.items.map((item) => item.id),
    ).toEqual(["sofa", "desk"]);
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("inventory reads the completed reconstruction's artifacts after a later publication", async () => {
  const input = await buildPreparedFixture();
  writeJson({
    path: join(input.folder, ".planner", "jobs.json"),
    value: [input.reconstruction],
  });
  const other = {
    scenePath: join(input.folder, "recon", "other.npz"),
    camerasPath: join(input.folder, "recon", "other.json"),
  };
  writeFileSync(other.scenePath, "later points");
  writeFileSync(other.camerasPath, "[]");
  writeJson({ path: join(input.folder, "recon", "room.json"), value: other });
  const recovered = createRecoveredQueue(input);
  try {
    const started = recovered.queue.start(input.projectId);
    const saved = readProjectJobRecords(input.folder).find(
      (record) => record.job.id === started.jobId,
    );
    expect(saved?.scenePath).toBe(input.reconstruction.artifacts.scenePath);
    expect(saved?.camerasPath).toBe(input.reconstruction.artifacts.camerasPath);
  } finally {
    await recovered.queue.stopAll();
    await input.fixture.close();
  }
});

test("inventory keeps its original undo list across deletion, recovery and restoration", async () => {
  const input = await buildPreparedFixture({
    appliedItemIds: ["sofa", "desk"],
    removedItemIds: ["desk"],
  });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    const diff = recovered.chat
      .list(input.projectId)
      .find((message) => message.id === input.record.job.id)
      ?.blocks.find((block) => block.kind === "diff");
    expect(diff?.undo).toEqual([
      { type: "item.remove", itemId: "desk" },
      { type: "item.remove", itemId: "sofa" },
    ]);
    recovered.store.applyCommand({
      projectId: input.projectId,
      command: { type: "item.add", item: buildItem({ id: "desk" }) },
      requestId: undefined,
    });
    for (const command of diff?.undo ?? []) {
      recovered.store.applyCommand({
        projectId: input.projectId,
        command,
        requestId: undefined,
      });
      recovered.queue.itemRemoved(input.projectId);
    }
    const after = recovered.chat
      .list(input.projectId)
      .find((message) => message.id === input.record.job.id)
      ?.blocks.find((block) => block.kind === "diff");
    expect(after?.undo).toEqual(diff?.undo);
    expect(recovered.store.loadProject(input.projectId).scene.items).toEqual(
      [],
    );
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("completion replay replaces persisted notes instead of appending them", async () => {
  const input = await buildPreparedFixture({
    appliedItemIds: ["sofa", "desk"],
  });
  const note = {
    kind: "text",
    markdown: "Sofa is hidden",
  } satisfies NonNullable<InventoryRecord["outcome"]>["blocks"][number];
  input.record.outcome.blocks.push(note);
  writeJson({
    path: join(input.folder, ".planner", "jobs.json"),
    value: [input.reconstruction, input.record],
  });
  input.fixture.daemon.chat.add({
    projectId: input.projectId,
    message: {
      id: input.record.job.id,
      author: { kind: "agent", role: "surveyor" },
      createdAt: input.record.job.createdAt,
      status: "streaming",
      blocks: [
        { kind: "job", jobId: input.record.job.id },
        {
          kind: "diff",
          changes: [{ label: "Sofa", before: "", after: "added" }],
          undo: input.record.outcome.undo,
        },
        note,
      ],
    },
  });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    const message = recovered.chat
      .list(input.projectId)
      .find((message) => message.id === input.record.job.id);
    expect(message?.blocks.filter((block) => block.kind === "text")).toEqual([
      note,
    ]);
    expect(
      message?.blocks.filter((block) => block.kind === "diff"),
    ).toHaveLength(1);
    expect(message?.status).toBe("done");
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("removing an older inventory item cancels its queued job after a newer receipt", async () => {
  const input = await buildPreparedFixture({
    appliedItemIds: ["sofa", "desk"],
  });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    recovered.store.applyCommand({
      projectId: input.projectId,
      command: { type: "item.add", item: buildItem({ id: "lamp" }) },
      requestId: undefined,
      inventory: { jobId: randomUUID(), appliedItemIds: ["lamp"] },
    });
    recovered.store.applyCommand({
      projectId: input.projectId,
      command: { type: "item.remove", itemId: "sofa" },
      requestId: undefined,
    });
    recovered.queue.itemRemoved(input.projectId);
    expect(recovered.queue.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generation-sofa", stage: "failed" }),
        expect.objectContaining({ id: "generation-desk", stage: "queued" }),
      ]),
    );
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("inventory saves preserve reconstruction records and reconstruction saves preserve inventory", async () => {
  const input = await buildPreparedFixture();
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    const records = readProjectJobRecords(input.folder);
    expect(
      records.find((record) => record.job.kind === "reconstruction"),
    ).toEqual(input.reconstruction);
    const updatedReconstruction = {
      ...input.reconstruction,
      job: { ...input.reconstruction.job, lastLogLine: "retained" },
    };
    writeProjectJobRecords({
      folder: input.folder,
      kind: "reconstruction",
      records: [updatedReconstruction],
    });
    expect(readProjectJobRecords(input.folder)).toEqual([
      records.find((record) => record.job.kind === "inventory"),
      updatedReconstruction,
    ]);
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("submissions outside an active surveyor turn cannot change persisted inventory", async () => {
  const input = await buildPreparedFixture();
  const recovered = createRecoveredQueue(input);
  try {
    const before = readProjectJobRecords(input.folder);
    expect(() =>
      recovered.queue.submit({
        projectId: input.projectId,
        turnId: randomUUID(),
        objects: [],
      }),
    ).toThrow("surveyor turn is not running");
    expect(readProjectJobRecords(input.folder)).toEqual(before);
  } finally {
    await recovered.queue.stopAll();
    await input.fixture.close();
  }
});

test("an active surveyor accepts an identical retry and refuses other turns, photos and changed submissions", async () => {
  const input = await buildPreparedFixture();
  writeJson({
    path: join(input.folder, ".planner", "jobs.json"),
    value: [input.reconstruction, { ...input.record, outcome: undefined }],
  });
  writeJson({
    path: join(input.folder, "photos", "photos.json"),
    value: {
      version: 1,
      photos: input.record.photoIds.map((photoId) => ({
        photoId,
        origin: "capture",
        sourceFileName: `${photoId}.jpg`,
        widthPx: 400,
        heightPx: 300,
        orientation: 1,
        blurScore: 100,
        kind: "accepted",
        uprightPath: `upright/${photoId}.jpg`,
        visionPath: `vision/${photoId}.jpg`,
        visionWidthPx: 200,
        visionHeightPx: 150,
      })),
    },
  });
  const recovered = createRecoveredQueue(input);
  const turn = Promise.withResolvers<AgentRunResult>();
  const finished = {
    sessionId: undefined,
    isError: false,
    stopReason: undefined,
    finalText: "Inventory submitted",
    costUsd: undefined,
    sessionCostUsd: undefined,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    numTurns: 1,
    toolUses: 1,
    abortedByBudget: false,
    interrupted: false,
  } satisfies AgentRunResult;
  recovered.runTurn.mockImplementation(() => turn.promise);
  try {
    recovered.queue.resume();
    await vi.waitFor(() => expect(recovered.runTurn).toHaveBeenCalledOnce());
    const sessionId = recovered.runTurn.mock.calls.at(0)?.at(0)?.session.id;
    if (!sessionId) throw new Error("Expected surveyor session ID");
    const turnId = sessionId.slice("surveyor-".length, -"-1".length);
    const submit = { projectId: input.projectId, turnId, objects: [] };
    expect(() =>
      recovered.queue.submit({ ...submit, turnId: randomUUID() }),
    ).toThrow("surveyor turn is not running");
    expect(() =>
      recovered.queue.submit({ ...submit, projectId: randomUUID() }),
    ).toThrow("surveyor turn is not running");
    const object = {
      objectId: "sofa",
      name: "Sofa",
      mount: "floor",
      bestPhotoId: "photo-1",
      views: [
        {
          photoId: "photo-1",
          box: [0, 0, 201, 150],
          visibility: "mostly-visible",
        },
      ],
    } satisfies NonNullable<InventoryRecord["submission"]>[number];
    expect(() =>
      recovered.queue.submit({ ...submit, objects: [object] }),
    ).toThrow("pinned capture photo's vision copy");
    expect(recovered.queue.submit(submit)).toEqual({ submitted: 0 });
    expect(recovered.queue.submit(submit)).toEqual({ submitted: 0 });
    expect(() =>
      recovered.queue.submit({
        ...submit,
        objects: [
          {
            ...object,
            views: [
              {
                photoId: "photo-1",
                box: [0, 0, 200, 150],
                visibility: "mostly-visible",
              },
            ],
          },
        ],
      }),
    ).toThrow("already been submitted");
    turn.resolve(finished);
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    expect(() => recovered.queue.submit(submit)).toThrow(
      "surveyor turn is not running",
    );
    expect(recovered.store.loadProject(input.projectId).scene.items).toEqual(
      [],
    );
  } finally {
    turn.resolve(finished);
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("outside measurements add a named chat note without an item or generation job", async () => {
  const input = await buildPreparedFixture();
  const submission = ["sofa", "balcony-table"].map(
    (objectId) =>
      ({
        objectId,
        name: objectId === "sofa" ? "Sofa" : "Balcony table",
        mount: "floor",
        bestPhotoId: "photo-1",
        views: [
          {
            photoId: "photo-1",
            box: [0, 0, 200, 150],
            visibility: "mostly-visible",
          },
        ],
      }) satisfies NonNullable<InventoryRecord["submission"]>[number],
  );
  writeJson({
    path: join(input.folder, ".planner", "jobs.json"),
    value: [
      input.reconstruction,
      { ...input.record, outcome: undefined, submission },
    ],
  });
  writeJson({
    path: join(input.folder, "photos", "photos.json"),
    value: {
      version: 1,
      photos: input.record.photoIds.map((photoId) => ({
        photoId,
        origin: "capture",
        sourceFileName: `${photoId}.jpg`,
        widthPx: 400,
        heightPx: 300,
        orientation: 1,
        blurScore: 100,
        kind: "accepted",
        uprightPath: `upright/${photoId}.jpg`,
        visionPath: `vision/${photoId}.jpg`,
        visionWidthPx: 200,
        visionHeightPx: 150,
      })),
    },
  });
  const requirement = vi
    .spyOn(reconstructionRequirements, "checkReconstructionRequirements")
    .mockReturnValue({ segmentationModel: "sam3", notice: undefined });
  const sofa = buildItem({ id: "sofa" });
  const measurement = vi
    .spyOn(inventoryMeasurement, "runInventoryMeasurement")
    .mockResolvedValue({
      objects: [
        { objectId: "sofa", sizeM: sofa.sizeM, placement: sofa.placement },
      ],
      failures: [
        {
          objectId: "balcony-table",
          message:
            "Skipped because its measured footprint centre is outside the room",
        },
      ],
    });
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    expect(
      recovered.store
        .loadProject(input.projectId)
        .scene.items.map((item) => item.name),
    ).toEqual(["Sofa"]);
    expect(
      recovered.queue.list().filter((job) => job.kind === "generation"),
    ).toHaveLength(1);
    expect(
      recovered.chat.list(input.projectId).flatMap((message) => message.blocks),
    ).toContainEqual({
      kind: "text",
      markdown:
        "Balcony table: could not measure this object. Skipped because its measured footprint centre is outside the room",
    });
    expect(recovered.runTurn).not.toHaveBeenCalled();
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
    requirement.mockRestore();
    measurement.mockRestore();
  }
});

test("surface material edits do not invalidate measured inventory", async () => {
  const input = await buildPreparedFixture();
  input.fixture.daemon.store.applyCommand({
    projectId: input.projectId,
    requestId: undefined,
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#eeeedd",
      material: {
        kind: "planks",
        plankSizeM: { u: 0.2, v: 1.2 },
        baseColor: "#ccaa88",
        roughness: 0.5,
      },
    },
  });
  input.fixture.daemon.store.flush();
  const recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    await waitForInventory({ queue: recovered.queue, stage: "done" });
    expect(
      recovered.store
        .loadProject(input.projectId)
        .scene.items.map((item) => item.id),
    ).toEqual(["sofa", "desk"]);
    expect(
      recovered.store.loadProject(input.projectId).scene.room.surfaces.floor
        ?.material?.kind,
    ).toBe("planks");
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test("cancelled queued inventory stays cancelled after recovery without applying its outcome", async () => {
  const input = await buildPreparedFixture();
  const record = {
    ...input.record,
    job: { ...input.record.job, stage: "queued" },
  } satisfies InventoryRecord;
  writeProjectJobRecords({
    folder: input.folder,
    kind: "inventory",
    records: [record],
  });
  let recovered = createRecoveredQueue(input);
  try {
    recovered.queue.resume();
    expect(
      recovered.queue.cancel({
        projectId: input.projectId,
        jobId: input.record.job.id,
      }),
    ).toEqual({ jobId: input.record.job.id, stage: "cancelled" });
    await recovered.queue.stopAll();
    recovered.store.flush();
    recovered = createRecoveredQueue(input);
    recovered.queue.resume();
    await recovered.queue.stopAll();
    expect(
      recovered.queue.list().find((job) => job.id === input.record.job.id)
        ?.stage,
    ).toBe("cancelled");
    expect(recovered.store.loadProject(input.projectId).scene.items).toEqual(
      [],
    );
    expect(recovered.runTurn).not.toHaveBeenCalled();
  } finally {
    await recovered.queue.stopAll();
    recovered.store.flush();
    await input.fixture.close();
  }
});

test.each([false, true])(
  "cancelled queued retries preserve partially applied inventory across restart (room changed: %s)",
  async (changedRoom) => {
    const input = await buildPreparedFixture({ appliedItemIds: ["sofa"] });
    const failed = {
      ...input.record,
      job: { ...input.record.job, stage: "failed" },
    } satisfies InventoryRecord;
    writeProjectJobRecords({
      folder: input.folder,
      kind: "inventory",
      records: [failed],
    });
    const blockingProject = input.fixture.daemon.store.createProject({
      name: "Blocking inventory",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    });
    input.fixture.daemon.store.flush();
    const blocking = {
      ...input.record,
      job: {
        ...input.record.job,
        id: "blocking-inventory",
        projectId: blockingProject.id,
        stage: "queued",
      },
      photoIds: [],
      outcome: undefined,
    } satisfies InventoryRecord;
    writeProjectJobRecords({
      folder: input.fixture.daemon.store.projectPath(blockingProject.id),
      kind: "inventory",
      records: [blocking],
    });
    let recovered = createRecoveredQueue(input);
    const turn = Promise.withResolvers<AgentRunResult>();
    recovered.runTurn.mockImplementation(() => turn.promise);
    try {
      recovered.queue.resume();
      await vi.waitFor(() => expect(recovered.runTurn).toHaveBeenCalledOnce());
      expect(recovered.queue.start(input.projectId)).toEqual({
        jobId: input.record.job.id,
      });
      expect(
        recovered.queue.cancel({
          projectId: input.projectId,
          jobId: input.record.job.id,
        }),
      ).toEqual({ jobId: input.record.job.id, stage: "cancelled" });
      turn.reject(new Error("Stop blocking inventory"));
      await recovered.queue.stopAll();
      recovered.store.flush();
      recovered = createRecoveredQueue(input);
      recovered.runTurn.mockRejectedValue(
        new Error("Blocking inventory ended"),
      );
      recovered.queue.resume();
      await vi.waitFor(() =>
        expect(
          recovered.queue.list().find((job) => job.id === blocking.job.id)
            ?.stage,
        ).toBe("failed"),
      );
      expect(
        recovered.queue.list().find((job) => job.id === input.record.job.id)
          ?.stage,
      ).toBe("cancelled");
      if (changedRoom) {
        recovered.store.applyCommand({
          projectId: input.projectId,
          command: { type: "room.update", ceilingHeightM: 3 },
          requestId: undefined,
        });
        expect(() => recovered.queue.start(input.projectId)).toThrow(
          "Restore its room dimensions",
        );
        recovered.store.applyCommand({
          projectId: input.projectId,
          command: { type: "room.update", ceilingHeightM: 2.8 },
          requestId: undefined,
        });
      }
      expect(recovered.queue.start(input.projectId)).toEqual({
        jobId: input.record.job.id,
      });
      await vi.waitFor(() =>
        expect(
          recovered.queue.list().find((job) => job.id === input.record.job.id)
            ?.stage,
        ).toBe("done"),
      );
      const project = recovered.store.loadProject(input.projectId);
      expect(project.scene.items.map((item) => item.id)).toEqual([
        "sofa",
        "desk",
      ]);
      expect(project.inventory).toEqual({
        jobId: input.record.job.id,
        appliedItemIds: ["sofa", "desk"],
      });
      expect(
        recovered.events.flatMap((event) =>
          event.kind === "scene.changed" &&
          event.projectId === input.projectId &&
          event.command.type === "item.add"
            ? [event.command.item.id]
            : [],
        ),
      ).toEqual(["desk"]);
      expect(
        readProjectJobRecords(input.folder).filter(
          (record) => record.job.kind === "inventory",
        ),
      ).toHaveLength(1);
    } finally {
      turn.reject(new Error("Stop blocking inventory"));
      await recovered.queue.stopAll();
      recovered.store.flush();
      await input.fixture.close();
    }
  },
);
