import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { BulbJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createChatStore } from "../chat/create-chat-store.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { writeProjectJobRecords } from "../jobs/write-project-job-records.ts";
import { createProjectStore } from "../project/create-project-store.ts";
import { EventBus } from "../ws/event-bus.ts";
import type { BulbRecord } from "./bulb-record-schema.ts";
import type { BulbViews } from "./create-bulb-queue.ts";
import { createBulbQueue } from "./create-bulb-queue.ts";

const defaultLight = {
  on: true,
  emitter: { x: 0.5, y: 0.85, z: 0.5 },
  beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
  lumens: 800,
  temperatureK: 2700,
} satisfies Item["light"];

const lamp = {
  id: "lamp",
  name: "Arc floor lamp",
  model: { kind: "asset", assetId: "lamp-asset" },
  placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
  sizeM: { width: 0.7, height: 1.5, depth: 0.3 },
  light: defaultLight,
  locked: false,
} satisfies Item;

function buildFixture(options: {
  scenario?: string;
  views?: (input: { folder: string }) => Promise<BulbViews>;
}) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/bulb-queue-"));
  const bus = new EventBus();
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const store = createProjectStore({
    projectsRoot: join(root, "projects"),
    catalogRoot: join(root, "catalog"),
    catalogAssetIds: new Set(),
    bus,
    logger,
    writeDelayMs: 100000,
  });
  const project = store.createProject({
    name: "Bulbs",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  const env = {
    PATH: process.env.PATH ?? "",
    PLANNER_HOME: join(root, "home"),
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
    PLANNER_FAKE_SCENARIO: options.scenario ?? "bulb",
  };
  const runtime = createAgentRuntime({ env });
  const chat = createChatStore({ bus, projectPath: store.projectPath });
  async function renderViews(input: { folder: string }): Promise<BulbViews> {
    if (options.views) return options.views(input);
    for (const name of ["front.png", "side.png"])
      writeFileSync(join(input.folder, name), "png");
    return {
      kind: "rendered",
      frontPath: join(input.folder, "front.png"),
      sidePath: join(input.folder, "side.png"),
    };
  }
  function queue() {
    return createBulbQueue({
      store,
      chat,
      bus,
      logger,
      runtime,
      config: createDefaultConfig,
      env,
      agentSlots: createTurnSlots({ size: 1 }),
      renderViews,
    });
  }
  function apply(command: Command) {
    return store.applyCommand({
      projectId: project.id,
      command,
      requestId: undefined,
    });
  }
  function item() {
    return store
      .loadProject(project.id)
      .scene.items.find((candidate) => candidate.id === "lamp");
  }
  return {
    store,
    project,
    chat,
    queue,
    apply,
    item,
    close() {
      store.flush();
      runtime.killAll();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitForStage(input: {
  queue: ReturnType<ReturnType<typeof buildFixture>["queue"]>;
  stage: string;
}) {
  await vi.waitFor(
    () => {
      const job = input.queue.list().at(-1);
      expect(job?.stage, job?.error).toBe(input.stage);
    },
    { timeout: 15_000 },
  );
  return input.queue.list().at(-1);
}

test("places the bulb and beam with one undoable update", async () => {
  const fixture = buildFixture({});
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    const original = fixture.store.loadProject(fixture.project.id).scene;
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const job = await waitForStage({ queue, stage: "done" });
    expect(job?.lastLogLine).toBe("placed the bulb");
    expect(fixture.item()?.light).toStrictEqual({
      ...defaultLight,
      emitter: { x: 0.15, y: 0.8, z: 0.5 },
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 100 },
      shade: "translucent",
      lumens: 600,
    });
    const diff = fixture.chat
      .list(fixture.project.id)
      .find((message) => message.id === job?.id)
      ?.blocks.find((block) => block.kind === "diff");
    if (diff?.kind !== "diff") throw new Error("Missing Place bulb diff");
    expect(diff.changes).toStrictEqual([
      {
        label: "Place bulb",
        before: "x 50%, y 85%, z 50%, down 90°, opaque shade, 800 lm",
        after: "x 15%, y 80%, z 50%, down 100°, translucent shade, 600 lm",
      },
    ]);
    for (const command of diff.undo) fixture.apply(command);
    expect(fixture.store.loadProject(fixture.project.id).scene).toStrictEqual(
      original,
    );
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a null beam removes the beam and an invalid beam keeps it", async () => {
  for (const entry of [
    { scenario: "bulb-null-beam", expected: undefined },
    { scenario: "bulb-bad-beam", expected: defaultLight.beam },
  ]) {
    const fixture = buildFixture({ scenario: entry.scenario });
    const queue = fixture.queue();
    try {
      fixture.apply({ type: "item.add", item: lamp });
      queue.find({ projectId: fixture.project.id, itemId: "lamp" });
      await waitForStage({ queue, stage: "done" });
      expect(fixture.item()?.light?.emitter).toStrictEqual({
        x: 0.3,
        y: 0.6,
        z: 0.5,
      });
      expect(fixture.item()?.light?.beam).toStrictEqual(entry.expected);
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  }
});

test("an answer without valid fractions keeps the mount default", async () => {
  const fixture = buildFixture({ scenario: "bulb-unsure" });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const job = await waitForStage({ queue, stage: "done" });
    expect(job?.lastLogLine).toBe("kept the mount default");
    expect(fixture.item()?.light).toStrictEqual(defaultLight);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a CLI error fails the job and leaves the light", async () => {
  const fixture = buildFixture({ scenario: "simple-failure" });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    await waitForStage({ queue, stage: "failed" });
    expect(fixture.item()?.light).toStrictEqual(defaultLight);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("missing Blender fails the job with its notice", async () => {
  const fixture = buildFixture({
    views: async () => ({
      kind: "missing",
      notice: {
        kind: "notice",
        detail: { kind: "error" },
        text: "Blender is missing",
      },
    }),
  });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const job = await waitForStage({ queue, stage: "failed" });
    expect(job?.error).toBe("Blender is missing");
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("an edit to the light during the job skips the answer", async () => {
  const fixture = buildFixture({
    views: async (input) => {
      fixture.apply({
        type: "item.update",
        itemId: "lamp",
        patch: {
          light: { ...defaultLight, emitter: { x: 0.9, y: 0.9, z: 0.9 } },
        },
      });
      for (const name of ["front.png", "side.png"])
        writeFileSync(join(input.folder, name), "png");
      return {
        kind: "rendered",
        frontPath: join(input.folder, "front.png"),
        sidePath: join(input.folder, "side.png"),
      };
    },
  });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const job = await waitForStage({ queue, stage: "done" });
    expect(job?.lastLogLine).toBe("skipped: the item changed");
    expect(fixture.item()?.light?.emitter).toStrictEqual({
      x: 0.9,
      y: 0.9,
      z: 0.9,
    });
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("refuses an item without a light and reuses an active job", async () => {
  const fixture = buildFixture({ scenario: "sleep" });
  const queue = fixture.queue();
  try {
    const { light: _light, ...unlit } = lamp;
    fixture.apply({ type: "item.add", item: { ...unlit, id: "plain" } });
    expect(() =>
      queue.find({ projectId: fixture.project.id, itemId: "plain" }),
    ).toThrow("This item has no light");
    fixture.apply({ type: "item.add", item: lamp });
    const first = queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    expect(
      queue.find({ projectId: fixture.project.id, itemId: "lamp" }),
    ).toStrictEqual(first);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a pending lamp waits for its model, and a new model starts a job", async () => {
  const fixture = buildFixture({});
  const queue = fixture.queue();
  try {
    fixture.apply({
      type: "item.add",
      item: { ...lamp, model: { kind: "pending", jobId: "generation" } },
    });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    await new Promise((settle) => setTimeout(settle, 300));
    expect(queue.list().at(-1)?.stage).toBe("queued");
    const command = {
      type: "item.update",
      itemId: "lamp",
      patch: { model: { kind: "asset", assetId: "lamp-asset" } },
    } satisfies Command;
    fixture.apply(command);
    queue.sceneChanged({ projectId: fixture.project.id, command });
    await waitForStage({ queue, stage: "done" });
    expect(queue.list()).toHaveLength(1);
    expect(fixture.item()?.light?.emitter).toStrictEqual({
      x: 0.15,
      y: 0.8,
      z: 0.5,
    });
    const regenerated = {
      type: "item.update",
      itemId: "lamp",
      patch: { model: { kind: "asset", assetId: "lamp-asset-2" } },
    } satisfies Command;
    fixture.apply(regenerated);
    queue.sceneChanged({ projectId: fixture.project.id, command: regenerated });
    expect(queue.list()).toHaveLength(2);
    await waitForStage({ queue, stage: "done" });
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("removing the light cancels a queued job", async () => {
  const fixture = buildFixture({});
  const queue = fixture.queue();
  try {
    fixture.apply({
      type: "item.add",
      item: { ...lamp, model: { kind: "pending", jobId: "generation" } },
    });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const command = {
      type: "item.update",
      itemId: "lamp",
      patch: { light: null },
    } satisfies Command;
    fixture.apply(command);
    queue.sceneChanged({ projectId: fixture.project.id, command });
    expect(queue.list().at(-1)?.stage).toBe("cancelled");
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

function writeRecords(input: {
  fixture: ReturnType<typeof buildFixture>;
  records: BulbRecord[];
}) {
  writeProjectJobRecords({
    folder: input.fixture.store.projectPath(input.fixture.project.id),
    kind: "bulb",
    records: input.records,
  });
}

function buildJob(input: {
  projectId: string;
  id: string;
  stage: BulbJob["stage"];
}) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    kind: "bulb",
    projectId: input.projectId,
    itemId: "lamp",
    stage: input.stage,
    progress: 0.6,
    createdAt: now,
    updatedAt: now,
  } satisfies BulbJob;
}

test("a restart reruns a job that was asking", async () => {
  const fixture = buildFixture({});
  try {
    fixture.apply({ type: "item.add", item: lamp });
    fixture.store.flush();
    writeRecords({
      fixture,
      records: [
        {
          job: buildJob({
            projectId: fixture.project.id,
            id: "asking",
            stage: "asking",
          }),
        },
      ],
    });
    const queue = fixture.queue();
    try {
      await queue.resume();
      const job = await waitForStage({ queue, stage: "done" });
      expect(job?.lastLogLine).toBe("placed the bulb");
      expect(fixture.item()?.light?.emitter).toStrictEqual({
        x: 0.15,
        y: 0.8,
        z: 0.5,
      });
    } finally {
      await queue.stopAll();
    }
  } finally {
    fixture.close();
  }
});

test("a restart applies a saved answer exactly once and never reapplies a finished job", async () => {
  const fixture = buildFixture({});
  try {
    fixture.apply({ type: "item.add", item: lamp });
    fixture.store.flush();
    const revision = fixture.store.loadProject(fixture.project.id).revision;
    writeRecords({
      fixture,
      records: [
        {
          job: buildJob({
            projectId: fixture.project.id,
            id: "finished",
            stage: "done",
          }),
          assetId: "lamp-asset",
          emitterAtStart: defaultLight.emitter,
          outcome: {
            kind: "placed",
            emitter: { x: 0.9, y: 0.9, z: 0.9 },
            revision,
          },
        },
        {
          job: buildJob({
            projectId: fixture.project.id,
            id: "answered",
            stage: "asking",
          }),
          assetId: "lamp-asset",
          emitterAtStart: defaultLight.emitter,
          outcome: { kind: "placed", emitter: { x: 0.3, y: 0.7, z: 0.5 } },
        },
      ],
    });
    for (const round of [1, 2]) {
      const queue = fixture.queue();
      try {
        await queue.resume();
        await vi.waitFor(() =>
          expect(queue.list().map((entry) => entry.stage)).toStrictEqual([
            "done",
            "done",
          ]),
        );
        expect(
          queue.list().map((entry) => [entry.id, entry.lastLogLine]),
        ).toStrictEqual([
          ["finished", undefined],
          ["answered", "placed the bulb"],
        ]);
        expect(fixture.item()?.light?.emitter).toStrictEqual({
          x: 0.3,
          y: 0.7,
          z: 0.5,
        });
        expect(
          fixture.store.loadProject(fixture.project.id).revision,
          `round ${round}`,
        ).toBe(revision + 1);
        fixture.store.flush();
      } finally {
        await queue.stopAll();
      }
    }
  } finally {
    fixture.close();
  }
});

test("a new model during a running job replaces the job", async () => {
  const published = {
    type: "item.update",
    itemId: "lamp",
    patch: { model: { kind: "asset", assetId: "lamp-asset-2" } },
  } satisfies Command;
  let isFirst = true;
  const fixture = buildFixture({
    views: async (input) => {
      if (isFirst) {
        isFirst = false;
        fixture.apply(published);
        queue.sceneChanged({
          projectId: fixture.project.id,
          command: published,
        });
      }
      for (const name of ["front.png", "side.png"])
        writeFileSync(join(input.folder, name), "png");
      return {
        kind: "rendered",
        frontPath: join(input.folder, "front.png"),
        sidePath: join(input.folder, "side.png"),
      };
    },
  });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    await vi.waitFor(() =>
      expect(queue.list().map((job) => job.stage)).toStrictEqual([
        "cancelled",
        "done",
      ]),
    );
    expect(queue.list().at(-1)?.lastLogLine).toBe("placed the bulb");
    expect(fixture.item()?.light?.emitter).toStrictEqual({
      x: 0.15,
      y: 0.8,
      z: 0.5,
    });
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("removing the item during a job ends it skipped", async () => {
  const fixture = buildFixture({
    views: async () => {
      fixture.apply({ type: "item.remove", itemId: "lamp" });
      throw new Error("The model file is gone");
    },
  });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    const job = await waitForStage({ queue, stage: "done" });
    expect(job?.lastLogLine).toBe("skipped: the item changed");
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("runs one bulb job at a time", async () => {
  let active = 0;
  let mostActive = 0;
  const fixture = buildFixture({
    views: async (input) => {
      active += 1;
      mostActive = Math.max(mostActive, active);
      await new Promise((settle) => setTimeout(settle, 50));
      active -= 1;
      for (const name of ["front.png", "side.png"])
        writeFileSync(join(input.folder, name), "png");
      return {
        kind: "rendered",
        frontPath: join(input.folder, "front.png"),
        sidePath: join(input.folder, "side.png"),
      };
    },
  });
  const queue = fixture.queue();
  try {
    for (const id of ["lamp-1", "lamp-2", "lamp-3"]) {
      fixture.apply({ type: "item.add", item: { ...lamp, id } });
      queue.find({ projectId: fixture.project.id, itemId: id });
    }
    await vi.waitFor(
      () =>
        expect(queue.list().map((job) => job.stage)).toStrictEqual([
          "done",
          "done",
          "done",
        ]),
      { timeout: 15_000 },
    );
    expect(mostActive).toBe(1);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("cancelling a job while it asks frees the slot for the next job", async () => {
  const fixture = buildFixture({ scenario: "sleep" });
  const queue = fixture.queue();
  try {
    for (const id of ["lamp-1", "lamp-2"]) {
      fixture.apply({ type: "item.add", item: { ...lamp, id } });
      queue.find({ projectId: fixture.project.id, itemId: id });
    }
    await vi.waitFor(() =>
      expect(queue.list().map((job) => job.stage)).toStrictEqual([
        "asking",
        "queued",
      ]),
    );
    const first = queue.list().at(0);
    if (!first) throw new Error("Missing first job");
    queue.cancel({ projectId: fixture.project.id, jobId: first.id });
    await vi.waitFor(() =>
      expect(queue.list().map((job) => job.stage)).toStrictEqual([
        "cancelled",
        "asking",
      ]),
    );
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a suggested brightness never replaces one the user edited", async () => {
  const fixture = buildFixture({});
  const queue = fixture.queue();
  try {
    fixture.apply({
      type: "item.add",
      item: { ...lamp, light: { ...defaultLight, lumens: 1200 } },
    });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    await waitForStage({ queue, stage: "done" });
    expect(fixture.item()?.light).toMatchObject({
      shade: "translucent",
      lumens: 1200,
    });
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a suggested brightness applies after the lamp moves onto a cabinet", async () => {
  const fixture = buildFixture({
    views: async (input) => {
      fixture.apply({
        type: "item.update",
        itemId: "lamp",
        patch: { placement: { ...lamp.placement, elevationM: 0.6 } },
      });
      for (const name of ["front.png", "side.png"])
        writeFileSync(join(input.folder, name), "png");
      return {
        kind: "rendered",
        frontPath: join(input.folder, "front.png"),
        sidePath: join(input.folder, "side.png"),
      };
    },
  });
  const queue = fixture.queue();
  try {
    fixture.apply({ type: "item.add", item: lamp });
    queue.find({ projectId: fixture.project.id, itemId: "lamp" });
    await waitForStage({ queue, stage: "done" });
    expect(fixture.item()?.light?.lumens).toBe(600);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});
