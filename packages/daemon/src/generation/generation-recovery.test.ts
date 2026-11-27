import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { VariantSpec } from "@planner/shared/src/generation/variant-spec-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { AssetMeta } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createChatStore } from "../chat/create-chat-store.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createProjectStore } from "../project/create-project-store.ts";
import { writeJson } from "../util/write-json.ts";
import { EventBus } from "../ws/event-bus.ts";
import { createGenerationQueue } from "./create-generation-queue.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "./generation-record-schema.ts";

function buildFixture() {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/generation-recovery-"));
  const bus = new EventBus();
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const failure = { nextWrite: false };
  const store = createProjectStore({
    projectsRoot: join(root, "projects"),
    catalogRoot: join(root, "catalog"),
    catalogAssetIds: new Set(),
    bus,
    logger,
    writeDelayMs: 100000,
    writeJson(options) {
      if (failure.nextWrite) {
        failure.nextWrite = false;
        throw new Error("Project write failed once");
      }
      writeJson(options);
    },
  });
  const project = store.createProject({
    name: "Recovery",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  const env = {
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
    BLENDER: join(root, "missing-blender"),
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
  };
  const runtime = createAgentRuntime({ env });
  function queue() {
    return createGenerationQueue({
      store,
      bus,
      logger,
      chat: createChatStore({ bus, projectPath: store.projectPath }),
      runtime,
      config: createDefaultConfig,
      env,
      plannerHome: env.PLANNER_HOME,
      allowedHosts: [],
      agentSlots: createTurnSlots({ size: 2 }),
      workerSlots: createTurnSlots({ size: 1 }),
      link: () => ({ token: "unused", wsUrl: "ws://127.0.0.1:1" }),
    });
  }
  return {
    store,
    project,
    failure,
    queue,
    root,
    close() {
      store.flush();
      runtime.killAll();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("a failed flush after insertion preserves the pending item's generation source", async () => {
  const fixture = buildFixture();
  const queue = fixture.queue();
  try {
    fixture.failure.nextWrite = true;
    expect(() =>
      queue.generate({
        projectId: fixture.project.id,
        spec: {
          name: "Sofa",
          prompt: "Sofa",
          sizeM: { width: 1.8, height: 0.8, depth: 0.9 },
          placement: {
            kind: "floor",
            xM: 0,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
          reference: { kind: "photo", photoId: "reference" },
        },
      }),
    ).toThrow("Could not write project");
    fixture.store.flush();
    const item = fixture.store
      .loadProject(fixture.project.id)
      .scene.items.at(0);
    expect(item?.model.kind).toBe("pending");
    const records = JSON.parse(
      readFileSync(
        join(
          fixture.store.projectPath(fixture.project.id),
          ".planner",
          "jobs.json",
        ),
        "utf8",
      ),
    );
    expect(records).toHaveLength(1);
    expect(GenerationRecordSchema.parse(records.at(0)).source).toEqual({
      kind: "photo",
      photoId: "reference",
    });
    expect(queue.list()).toHaveLength(1);
    if (!item) throw new Error("Missing pending item");
    expect(() =>
      queue.start({ projectId: fixture.project.id, itemId: item.id }),
    ).not.toThrow();
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test.each([
  { recovery: "command", regenerating: false, opening: false },
  { recovery: "command", regenerating: false, opening: true },
  { recovery: "command", regenerating: true, opening: false },
  { recovery: "command", regenerating: true, opening: true },
  { recovery: "restart", regenerating: false, opening: false },
  { recovery: "restart", regenerating: false, opening: true },
  { recovery: "restart", regenerating: true, opening: false },
  { recovery: "restart", regenerating: true, opening: true },
])(
  "prepared asset recovers via $recovery (regenerating=$regenerating, opening=$opening) without another update, keeping a light added after queuing",
  async ({ recovery, regenerating, opening }) => {
    const fixture = buildFixture();
    let queue = fixture.queue();
    try {
      const now = new Date().toISOString();
      const item = {
        id: "sofa",
        name: "Sofa",
        sizeM: { width: 1.8, height: 0.8, depth: 0.9 },
        ...(opening ? { cutsOpening: true } : {}),
        placement: opening
          ? {
              kind: "wall",
              wallId: "wall-1",
              alongM: 2,
              heightM: 1,
              rotationRad: 0,
            }
          : {
              kind: "floor",
              xM: 0,
              zM: 0,
              elevationM: 0,
              rotationRad: 0,
            },
        model: regenerating
          ? { kind: "asset", assetId: "original" }
          : { kind: "pending", jobId: "generation" },
        locked: true,
        mirrored: true,
        colorAdjust: { kind: "colorize", color: "#123456", strength: 0.6 },
        light: {
          on: true,
          emitter: { x: 0.2, y: 0.85, z: 0.5 },
          lumens: 800,
          temperatureK: 2700,
        },
      } satisfies Item;
      fixture.store.applyCommand({
        projectId: fixture.project.id,
        requestId: undefined,
        command: { type: "item.add", item },
      });
      fixture.store.flush();
      const { light: _lightAddedAfterQueuing, ...queuedItem } = item;
      const record = GenerationRecordSchema.parse({
        job: {
          id: "generation",
          kind: "generation",
          projectId: fixture.project.id,
          itemId: item.id,
          stage: "generating",
          progress: 0.7,
          createdAt: now,
          updatedAt: now,
        },
        item: queuedItem,
        source: { kind: "photo", photoId: "reference" },
        prompt: "Sofa",
        ...(regenerating ? { regeneration: {}, notes: "Oval legs" } : {}),
        held: false,
        attempt: 0,
        assetId: "finished",
        prepared: {
          id: "finished",
          kind: "generated",
          mount: item.placement.kind,
          nativeSizeM: opening ? { ...item.sizeM, depth: 0.25 } : item.sizeM,
          triangleCount: 12,
          hasColorMask: true,
          referenceLuma: 0.5,
          provenance: { method: "modeler", sourcePhotoIds: [] },
        },
      });
      writeJson({
        path: join(
          fixture.store.projectPath(fixture.project.id),
          ".planner",
          "jobs.json",
        ),
        value: [record],
      });
      const currentItem = regenerating
        ? { ...item, sizeM: { width: 2.2, height: 1.1, depth: 1.3 } }
        : item;
      if (regenerating) {
        fixture.store.applyCommand({
          projectId: fixture.project.id,
          requestId: undefined,
          command: {
            type: "item.update",
            itemId: item.id,
            patch: { sizeM: currentItem.sizeM },
          },
        });
        fixture.store.flush();
      }
      fixture.failure.nextWrite = true;
      await queue.resume();
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
      const revision = fixture.store.loadProject(fixture.project.id).revision;
      if (recovery === "restart") {
        await queue.stopAll();
        queue = fixture.queue();
        await queue.resume();
      } else queue.start({ projectId: fixture.project.id, itemId: item.id });
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("ready"));
      fixture.store.flush();
      expect(fixture.store.loadProject(fixture.project.id).revision).toBe(
        revision,
      );
      expect(queue.list().at(0)?.error).toBeUndefined();
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items.at(0),
      ).toStrictEqual({
        ...currentItem,
        model: { kind: "asset", assetId: "finished" },
      });
      if (regenerating) {
        const chat = createChatStore({
          bus: new EventBus(),
          projectPath: fixture.store.projectPath,
        });
        const diff = chat
          .list(fixture.project.id)
          .find((message) => message.id === "generation")
          ?.blocks.find((block) => block.kind === "diff");
        expect(diff?.kind).toBe("diff");
        if (diff?.kind !== "diff") throw new Error("Missing undo");
        expect(diff.undo).toEqual([
          {
            type: "item.update",
            itemId: item.id,
            patch: { model: item.model },
          },
        ]);
        expect(
          chat
            .list(fixture.project.id)
            .find((message) => message.id === "generation")
            ?.blocks.find((block) => block.kind === "asset"),
        ).toMatchObject({ sizeM: currentItem.sizeM });
        for (const command of diff.undo)
          fixture.store.applyCommand({
            projectId: fixture.project.id,
            requestId: undefined,
            command,
          });
        expect(
          fixture.store.loadProject(fixture.project.id).scene.items.at(0),
        ).toEqual(currentItem);
        await queue.stopAll();
        queue = fixture.queue();
        await queue.resume();
        expect(
          fixture.store.loadProject(fixture.project.id).scene.items.at(0),
        ).toEqual(currentItem);
      }
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  },
);

function queuedGenerationSpec() {
  return {
    name: "Queued chair",
    prompt: "Chair",
    sizeM: { width: 1, height: 1, depth: 1 },
    placement: {
      kind: "floor",
      xM: 0,
      zM: 0,
      elevationM: 0,
      rotationRad: 0,
    },
    reference: { kind: "photo", photoId: "reference" },
  } satisfies import("@planner/shared/src/generation/generation-spec-schema.ts").GenerationSpec;
}

test("cancelling queued generation holds its pending item across restart until generation.start", async () => {
  const fixture = buildFixture();
  let queue = fixture.queue();
  try {
    const generated = Array.from({ length: 3 }, () =>
      queue.generate({
        projectId: fixture.project.id,
        spec: queuedGenerationSpec(),
      }),
    );
    const first = generated.at(0);
    const queued = generated.at(2);
    if (!first || !queued) throw new Error("Missing fixture generation");
    expect(() =>
      queue.cancel({ projectId: fixture.project.id, jobId: first.jobId }),
    ).toThrow("Only queued jobs");
    expect(() =>
      queue.cancel({ projectId: "other-project", jobId: queued.jobId }),
    ).toThrow("Unknown job in this project");
    expect(
      queue.cancel({ projectId: fixture.project.id, jobId: queued.jobId }),
    ).toEqual({ jobId: queued.jobId, stage: "held" });
    expect(
      fixture.store
        .loadProject(fixture.project.id)
        .scene.items.find((item) => item.id === queued.itemId)?.model,
    ).toEqual({ kind: "pending", jobId: queued.jobId });
    await queue.stopAll();
    queue = fixture.queue();
    await queue.resume();
    expect(queue.list().find((job) => job.id === queued.jobId)?.stage).toBe(
      "held",
    );
    await vi.waitFor(() =>
      expect(queue.list().filter((job) => job.stage === "failed")).toHaveLength(
        2,
      ),
    );
    expect(queue.list().find((job) => job.id === queued.jobId)?.stage).toBe(
      "held",
    );
    expect(
      queue.start({ projectId: fixture.project.id, itemId: queued.itemId }),
    ).toEqual({ jobId: queued.jobId });
    expect(queue.list().find((job) => job.id === queued.jobId)?.stage).toBe(
      "generating",
    );
    expect(() =>
      queue.cancel({ projectId: fixture.project.id, jobId: queued.jobId }),
    ).toThrow("Only queued jobs");
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("cancelled alternatives remain cancelled after restart and leave the original item pending", async () => {
  const fixture = buildFixture();
  let queue = fixture.queue();
  try {
    const original = queue.generate({
      projectId: fixture.project.id,
      spec: queuedGenerationSpec(),
    });
    const other = queue.generate({
      projectId: fixture.project.id,
      spec: queuedGenerationSpec(),
    });
    queue.alternatives({
      projectId: fixture.project.id,
      itemId: other.itemId,
    });
    const alternatives = queue.alternatives({
      projectId: fixture.project.id,
      itemId: original.itemId,
    });
    for (const jobId of alternatives.jobIds)
      expect(queue.cancel({ projectId: fixture.project.id, jobId })).toEqual({
        jobId,
        stage: "cancelled",
      });
    await queue.stopAll();
    queue = fixture.queue();
    await queue.resume();
    expect(
      queue
        .list()
        .filter((job) => alternatives.jobIds.includes(job.id))
        .map((job) => job.stage),
    ).toEqual(["cancelled", "cancelled"]);
    expect(
      fixture.store
        .loadProject(fixture.project.id)
        .scene.items.find((item) => item.id === original.itemId)?.model,
    ).toEqual({ kind: "pending", jobId: original.jobId });
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("regeneration of a kept alternative uses the latest generation source and current item name", async () => {
  const fixture = buildFixture();
  let queue = fixture.queue();
  try {
    const original = queue.generate({
      projectId: fixture.project.id,
      spec: queuedGenerationSpec(),
    });
    await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
    queue.alternatives({
      projectId: fixture.project.id,
      itemId: original.itemId,
    });
    await vi.waitFor(() =>
      expect(queue.list().filter((job) => job.stage === "failed")).toHaveLength(
        3,
      ),
    );
    await queue.stopAll();
    const jobsPath = join(
      fixture.store.projectPath(fixture.project.id),
      ".planner",
      "jobs.json",
    );
    const saved = GenerationRecordSchema.array().parse(
      JSON.parse(readFileSync(jobsPath, "utf8")),
    );
    const alternative = saved.findLast(
      (record) => record.job.kind === "generation-alternative",
    );
    if (!alternative) throw new Error("Missing alternative");
    alternative.prompt = "Alternative prompt";
    alternative.source = { kind: "photo", photoId: "alternative-source" };
    writeJson({ path: jobsPath, value: saved });
    fixture.store.applyCommand({
      projectId: fixture.project.id,
      requestId: undefined,
      command: {
        type: "item.update",
        itemId: original.itemId,
        patch: {
          name: "Renamed chair",
          model: { kind: "asset", assetId: alternative.assetId },
        },
      },
    });
    queue = fixture.queue();
    await queue.resume();
    const regeneration = queue.regenerate({
      projectId: fixture.project.id,
      itemId: original.itemId,
    });
    const regenerated = GenerationRecordSchema.array()
      .parse(JSON.parse(readFileSync(jobsPath, "utf8")))
      .find((record) => record.job.id === regeneration.jobId);
    expect(regenerated).toMatchObject({
      source: { kind: "photo", photoId: "reference" },
      prompt: "Renamed chair",
    });
    expect(regenerated?.regeneration?.sourcePath).toBeUndefined();
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test.each(["pending", "asset"])(
  "a cancelled %s generation stays held across restart and regeneration starts it with fresh notes",
  async (modelKind) => {
    const fixture = buildFixture();
    let queue = fixture.queue();
    try {
      const original = queue.generate({
        projectId: fixture.project.id,
        spec: queuedGenerationSpec(),
      });
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
      if (modelKind === "asset")
        fixture.store.applyCommand({
          projectId: fixture.project.id,
          requestId: undefined,
          command: {
            type: "item.update",
            itemId: original.itemId,
            patch: { model: { kind: "asset", assetId: "original" } },
          },
        });
      const current = fixture.store
        .loadProject(fixture.project.id)
        .scene.items.at(0);
      for (let index = 0; index < 2; index++)
        queue.generate({
          projectId: fixture.project.id,
          spec: queuedGenerationSpec(),
        });
      const regeneration =
        modelKind === "asset"
          ? queue.regenerate({
              projectId: fixture.project.id,
              itemId: original.itemId,
              notes: "Old corrections",
            })
          : queue.start({
              projectId: fixture.project.id,
              itemId: original.itemId,
              notes: "Old corrections",
            });
      expect(
        queue.cancel({
          projectId: fixture.project.id,
          jobId: regeneration.jobId,
        }),
      ).toEqual({ jobId: regeneration.jobId, stage: "held" });
      fixture.store.flush();
      await queue.stopAll();
      queue = fixture.queue();
      await queue.resume();
      await vi.waitFor(() =>
        expect(
          queue.list().filter((job) => job.stage === "failed"),
        ).toHaveLength(modelKind === "asset" ? 3 : 2),
      );
      expect(
        queue.list().find((job) => job.id === regeneration.jobId),
      ).toMatchObject({ stage: "held" });
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items.at(0),
      ).toEqual(current);
      expect(
        queue.regenerate({
          projectId: fixture.project.id,
          itemId: original.itemId,
          notes: "Oval legs",
        }),
      ).toEqual(regeneration);
      await vi.waitFor(() =>
        expect(
          queue.list().find((job) => job.id === regeneration.jobId)?.stage,
        ).toBe("failed"),
      );
      const next = queue.regenerate({
        projectId: fixture.project.id,
        itemId: original.itemId,
      });
      expect(next.jobId).not.toBe(regeneration.jobId);
      await vi.waitFor(() =>
        expect(queue.list().find((job) => job.id === next.jobId)?.stage).toBe(
          "failed",
        ),
      );
      const saved = GenerationRecordSchema.array().parse(
        JSON.parse(
          readFileSync(
            join(
              fixture.store.projectPath(fixture.project.id),
              ".planner",
              "jobs.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(
        saved.find((record) => record.job.id === regeneration.jobId)?.notes,
      ).toBe("Oval legs");
      expect(
        saved.find((record) => record.job.id === next.jobId)?.notes,
      ).toBeUndefined();
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items.at(0),
      ).toEqual(current);
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  },
);

test.each(["pending", "asset"])(
  "regenerating a %s item keeps its model and notes through failure, retry and removal",
  async (modelKind) => {
    const fixture = buildFixture();
    const queue = fixture.queue();
    try {
      const original = queue.generate({
        projectId: fixture.project.id,
        spec: queuedGenerationSpec(),
      });
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
      if (modelKind === "asset") {
        const saved = GenerationRecordSchema.array()
          .parse(
            JSON.parse(
              readFileSync(
                join(
                  fixture.store.projectPath(fixture.project.id),
                  ".planner",
                  "jobs.json",
                ),
                "utf8",
              ),
            ),
          )
          .at(0);
        if (!saved) throw new Error("Missing generation source");
        fixture.store.applyCommand({
          projectId: fixture.project.id,
          requestId: undefined,
          command: {
            type: "item.update",
            itemId: original.itemId,
            patch: { model: { kind: "asset", assetId: saved.assetId } },
          },
        });
      }
      const item = fixture.store
        .loadProject(fixture.project.id)
        .scene.items.at(0);
      expect(item?.model.kind).toBe(modelKind);
      const regeneration = queue.regenerate({
        projectId: fixture.project.id,
        itemId: original.itemId,
        notes: "Three oval legs",
      });
      expect(regeneration.jobId).not.toBe(original.jobId);
      expect(
        queue.regenerate({
          projectId: fixture.project.id,
          itemId: original.itemId,
          notes: "Three oval legs",
        }),
      ).toEqual(regeneration);
      expect(() =>
        queue.regenerate({
          projectId: fixture.project.id,
          itemId: original.itemId,
          notes: "Four legs",
        }),
      ).toThrow("active generation");
      await vi.waitFor(() =>
        expect(
          queue.list().find((job) => job.id === regeneration.jobId)?.stage,
        ).toBe("failed"),
      );
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items.at(0),
      ).toEqual(item);
      expect(
        queue.start({ projectId: fixture.project.id, itemId: original.itemId }),
      ).toEqual(regeneration);
      fixture.store.applyCommand({
        projectId: fixture.project.id,
        requestId: undefined,
        command: { type: "item.remove", itemId: original.itemId },
      });
      queue.itemChanged(fixture.project.id);
      await vi.waitFor(() =>
        expect(
          queue.list().find((job) => job.id === regeneration.jobId)?.stage,
        ).toBe("failed"),
      );
      expect(fixture.store.loadProject(fixture.project.id).scene.items).toEqual(
        [],
      );
      await vi.waitFor(() =>
        expect(
          createChatStore({
            bus: new EventBus(),
            projectPath: fixture.store.projectPath,
          })
            .list(fixture.project.id)
            .find((message) => message.id === regeneration.jobId)?.status,
        ).toBe("failed"),
      );
      expect(
        queue.list().find((job) => job.id === regeneration.jobId),
      ).toMatchObject({ superseded: true });
      const records = GenerationRecordSchema.array().parse(
        JSON.parse(
          readFileSync(
            join(
              fixture.store.projectPath(fixture.project.id),
              ".planner",
              "jobs.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(
        records.find((record) => record.job.id === regeneration.jobId)?.notes,
      ).toBe("Three oval legs");
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  },
);

test.each([false, true])(
  "replacing the model cancels failed regenerations with another active attempt: %s",
  async (anotherAttempt) => {
    const fixture = buildFixture();
    const queue = fixture.queue();
    try {
      const generated = queue.generate({
        projectId: fixture.project.id,
        spec: queuedGenerationSpec(),
      });
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
      const original = GenerationRecordSchema.array()
        .parse(
          JSON.parse(
            readFileSync(
              join(
                fixture.store.projectPath(fixture.project.id),
                ".planner",
                "jobs.json",
              ),
              "utf8",
            ),
          ),
        )
        .at(0);
      if (!original) throw new Error("Missing original source");
      fixture.store.applyCommand({
        projectId: fixture.project.id,
        requestId: undefined,
        command: {
          type: "item.update",
          itemId: generated.itemId,
          patch: { model: { kind: "asset", assetId: original.assetId } },
        },
      });
      const failed = queue.regenerate({
        projectId: fixture.project.id,
        itemId: generated.itemId,
        notes: "Oval legs",
      });
      await vi.waitFor(() =>
        expect(queue.list().find((job) => job.id === failed.jobId)?.stage).toBe(
          "failed",
        ),
      );
      if (anotherAttempt)
        queue.regenerate({
          projectId: fixture.project.id,
          itemId: generated.itemId,
          notes: "Three oval legs",
        });
      fixture.store.applyCommand({
        projectId: fixture.project.id,
        requestId: undefined,
        command: {
          type: "item.update",
          itemId: generated.itemId,
          patch: { model: { kind: "asset", assetId: "alternative" } },
        },
      });
      queue.itemChanged(fixture.project.id);
      for (const job of queue
        .list()
        .filter((job) => job.id !== generated.jobId)) {
        expect(job.stage).toBe("failed");
        expect(job.superseded).toBe(true);
      }
      expect(() =>
        queue.start({
          projectId: fixture.project.id,
          itemId: generated.itemId,
        }),
      ).toThrow("Model this requires a pending item");
      await queue.stopAll();
      const jobsPath = join(
        fixture.store.projectPath(fixture.project.id),
        ".planner",
        "jobs.json",
      );
      const saved = GenerationRecordSchema.array().parse(
        JSON.parse(readFileSync(jobsPath, "utf8")),
      );
      if (anotherAttempt) {
        const cancelled = saved.find(
          (record) => record.job.id === failed.jobId,
        );
        if (!cancelled) throw new Error("Missing cancelled regeneration");
        cancelled.prepared = {
          id: cancelled.assetId,
          kind: "generated",
          mount: "floor",
          nativeSizeM: cancelled.item.sizeM,
          triangleCount: 12,
          hasColorMask: false,
          provenance: { method: "modeler", sourcePhotoIds: [] },
        };
        writeJson({ path: jobsPath, value: saved });
      }
      const restarted = fixture.queue();
      try {
        await restarted.resume();
        expect(
          restarted.list().find((job) => job.id === failed.jobId),
        ).toMatchObject({
          stage: "failed",
          superseded: true,
        });
        expect(
          fixture.store.loadProject(fixture.project.id).scene.items.at(0)
            ?.model,
        ).toEqual({ kind: "asset", assetId: "alternative" });
      } finally {
        await restarted.stopAll();
      }
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  },
);

async function checkVariant(options: {
  mirrored: boolean | undefined;
  light?: Item["light"];
  change: VariantSpec["change"];
  parentNativeSizeM: AssetMeta["nativeSizeM"];
  publishedSizeM?: Item["sizeM"];
}) {
  const fixture = buildFixture();
  let queue = fixture.queue();
  try {
    const parent = {
      id: "parent",
      name: "Parent",
      model: { kind: "asset", assetId: "parent-asset" },
      placement: {
        kind: "floor",
        xM: 0.4,
        zM: 0.7,
        elevationM: 0.2,
        rotationRad: 0.3,
      },
      sizeM: { width: 1.8, height: 0.8, depth: 0.9 },
      locked: false,
      ...(options.mirrored === undefined ? {} : { mirrored: options.mirrored }),
      ...(options.light === undefined ? {} : { light: options.light }),
    } satisfies Item;
    const meta = {
      id: "parent-asset",
      kind: "generated",
      mount: "floor",
      nativeSizeM: options.parentNativeSizeM,
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "fixture", sourcePhotoIds: [] },
    } satisfies AssetMeta;
    const projectPath = fixture.store.projectPath(fixture.project.id);
    const assetPath = join(projectPath, "assets", meta.id);
    mkdirSync(assetPath);
    writeJson({ path: join(assetPath, "meta.json"), value: meta });
    fixture.store.applyCommand({
      projectId: fixture.project.id,
      requestId: undefined,
      command: { type: "item.add", item: parent },
    });
    const created = queue.variant({
      projectId: fixture.project.id,
      spec: { itemId: parent.id, name: "Variant", change: options.change },
    });
    const expected = {
      ...parent,
      id: created.itemId,
      name: "Variant",
      model: { kind: "pending", jobId: created.jobId },
      sizeM:
        options.change.kind === "shape" ? options.change.sizeM : parent.sizeM,
    } satisfies Item;
    expect(
      fixture.store.loadProject(fixture.project.id).scene.items,
    ).toStrictEqual([parent, expected]);
    const jobsPath = join(projectPath, ".planner", "jobs.json");
    const record = GenerationRecordSchema.array()
      .parse(JSON.parse(readFileSync(jobsPath, "utf8")))
      .at(0);
    if (!record) throw new Error("Missing stored variant");
    expect(record.item).toStrictEqual(expected);
    await queue.stopAll();
    writeJson({
      path: jobsPath,
      value: [
        {
          ...record,
          prepared: {
            ...meta,
            id: record.assetId,
            nativeSizeM:
              options.change.kind === "shape"
                ? options.change.sizeM
                : meta.nativeSizeM,
          },
        },
      ],
    });
    queue = fixture.queue();
    await queue.resume();
    const finished = {
      ...expected,
      model: { kind: "asset", assetId: record.assetId },
      ...(options.publishedSizeM ? { sizeM: options.publishedSizeM } : {}),
    } satisfies Item;
    await vi.waitFor(() =>
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items,
      ).toStrictEqual([parent, finished]),
    );
    expect(
      ProjectSchema.parse(
        JSON.parse(readFileSync(join(projectPath, "project.json"), "utf8")),
      ).scene.items,
    ).toStrictEqual([parent, finished]);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
}

for (const mirrored of [undefined, false, true]) {
  for (const change of [
    { kind: "color", color: "#123456", strength: 1 },
    {
      kind: "shape",
      prompt: "A wider sofa",
      sizeM: { width: 2.4, height: 0.8, depth: 0.9 },
    },
  ] satisfies VariantSpec["change"][]) {
    test(`${change.kind} variants preserve mirrored ${String(mirrored)} through queuing and recovered publication`, () =>
      checkVariant({
        mirrored,
        change,
        parentNativeSizeM: { width: 1.8, height: 0.8, depth: 0.9 },
      }));
  }
}

for (const on of [false, true]) {
  test(`a variant keeps its parent's light, switched ${on ? "on" : "off"}`, () =>
    checkVariant({
      mirrored: true,
      light: {
        on,
        emitter: { x: 0.3, y: 0.85, z: 0.5 },
        lumens: 400,
        temperatureK: 2700,
      },
      change: { kind: "color", color: "#123456", strength: 1 },
      parentNativeSizeM: { width: 1.8, height: 0.8, depth: 0.9 },
    }));
}

test("a colour variant of a stretched parent publishes the model's own proportions", () =>
  checkVariant({
    mirrored: undefined,
    change: { kind: "color", color: "#123456", strength: 1 },
    parentNativeSizeM: { width: 1, height: 1, depth: 1 },
    publishedSizeM: { width: 1.8, height: 1.8, depth: 1.8 },
  }));

test("a generated wall opening keeps cutsOpening on its new item", async () => {
  const fixture = buildFixture();
  const queue = fixture.queue();
  try {
    const wall = fixture.project.scene.room.walls.at(0);
    if (!wall) throw new Error("Missing fixture wall");
    const generated = queue.generate({
      projectId: fixture.project.id,
      spec: {
        ...queuedGenerationSpec(),
        name: "Open doorway",
        placement: {
          kind: "wall",
          wallId: wall.id,
          alongM: 1,
          heightM: 1,
          rotationRad: 0,
        },
        cutsOpening: true,
      },
    });
    expect(
      fixture.store
        .loadProject(fixture.project.id)
        .scene.items.find((item) => item.id === generated.itemId)?.cutsOpening,
    ).toBe(true);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test.each([
  {
    nativeSizeM: { width: 1.2, height: 0.6, depth: 0.5 },
    publishedSizeM: undefined,
  },
  {
    nativeSizeM: { width: 1.2, height: 0.3, depth: 0.5 },
    publishedSizeM: { width: 1.2, height: 0.3, depth: 0.5 },
  },
  {
    nativeSizeM: { width: 1.2, height: 0.66, depth: 0.55 },
    publishedSizeM: undefined,
  },
])(
  "a regeneration with native size $nativeSizeM keeps the displayed size only within 20%",
  async (options) => {
    const fixture = buildFixture();
    let queue = fixture.queue();
    try {
      const original = queue.generate({
        projectId: fixture.project.id,
        spec: queuedGenerationSpec(),
      });
      await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
      const displayedM = { width: 1.2, height: 0.6, depth: 0.5 };
      fixture.store.applyCommand({
        projectId: fixture.project.id,
        requestId: undefined,
        command: {
          type: "item.update",
          itemId: original.itemId,
          patch: {
            model: { kind: "asset", assetId: "original-asset" },
            sizeM: displayedM,
          },
        },
      });
      const regeneration = queue.regenerate({
        projectId: fixture.project.id,
        itemId: original.itemId,
      });
      await vi.waitFor(() =>
        expect(
          queue.list().find((job) => job.id === regeneration.jobId)?.stage,
        ).toBe("failed"),
      );
      await queue.stopAll();
      const jobsPath = join(
        fixture.store.projectPath(fixture.project.id),
        ".planner",
        "jobs.json",
      );
      const saved = GenerationRecordSchema.array().parse(
        JSON.parse(readFileSync(jobsPath, "utf8")),
      );
      const record = saved.find(
        (record) => record.job.id === regeneration.jobId,
      );
      if (!record) throw new Error("Missing regeneration");
      record.job = { ...record.job, stage: "queued", error: undefined };
      record.prepared = {
        id: record.assetId,
        kind: "generated",
        mount: "floor",
        nativeSizeM: options.nativeSizeM,
        triangleCount: 12,
        hasColorMask: false,
        provenance: { method: "modeler", sourcePhotoIds: [] },
      };
      writeJson({ path: jobsPath, value: saved });
      queue = fixture.queue();
      await queue.resume();
      await vi.waitFor(() =>
        expect(
          fixture.store.loadProject(fixture.project.id).scene.items.at(0)
            ?.model,
        ).toEqual({ kind: "asset", assetId: record.assetId }),
      );
      expect(
        fixture.store.loadProject(fixture.project.id).scene.items.at(0)?.sizeM,
      ).toEqual(options.publishedSizeM ?? displayedM);
      const undo = GenerationRecordSchema.array()
        .parse(JSON.parse(readFileSync(jobsPath, "utf8")))
        .find((saved) => saved.job.id === regeneration.jobId)?.regeneration
        ?.publication?.undo;
      expect(undo).toMatchObject({
        type: "item.update",
        patch: {
          model: { kind: "asset", assetId: "original-asset" },
          ...(options.publishedSizeM ? { sizeM: displayedM } : {}),
        },
      });
      expect(undo?.type === "item.update" && "sizeM" in undo.patch).toBe(
        options.publishedSizeM !== undefined,
      );
      const diff = createChatStore({
        bus: new EventBus(),
        projectPath: fixture.store.projectPath,
      })
        .list(fixture.project.id)
        .find((message) => message.id === regeneration.jobId)
        ?.blocks.find((block) => block.kind === "diff");
      if (diff?.kind !== "diff") throw new Error("Missing diff");
      expect(diff.changes.map((change) => change.label)).toEqual([
        "Queued chair model",
        ...(options.publishedSizeM ? ["Queued chair size"] : []),
      ]);
      if (options.publishedSizeM)
        expect(diff.changes.at(1)).toMatchObject({
          before: "1.20 × 0.60 × 0.50 m",
          after: "1.20 × 0.30 × 0.50 m",
        });
    } finally {
      await queue.stopAll();
      fixture.close();
    }
  },
);

async function prepareFirstAttempt(options: {
  fixture: ReturnType<typeof buildFixture>;
}) {
  const queue = options.fixture.queue();
  const generated = queue.generate({
    projectId: options.fixture.project.id,
    spec: queuedGenerationSpec(),
  });
  await vi.waitFor(() => expect(queue.list().at(0)?.stage).toBe("failed"));
  await queue.stopAll();
  const projectPath = options.fixture.store.projectPath(
    options.fixture.project.id,
  );
  const jobsPath = join(projectPath, ".planner", "jobs.json");
  const saved = GenerationRecordSchema.array().parse(
    JSON.parse(readFileSync(jobsPath, "utf8")),
  );
  const record = saved.find((record) => record.job.id === generated.jobId);
  if (!record) throw new Error("Missing generation");
  const sizeMismatches = [
    { axis: "height", actualM: 0.49, expectedM: 0.67 },
  ] satisfies GenerationRecord["sizeMismatches"];
  record.job = { ...record.job, stage: "queued", error: undefined };
  record.attempt = 1;
  record.firstAttempt = {
    meta: {
      id: record.assetId,
      kind: "generated",
      mount: "floor",
      nativeSizeM: { width: 1, height: 0.49, depth: 1 },
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "modeler", sourcePhotoIds: [] },
    },
    sizeMismatches,
  };
  writeJson({ path: jobsPath, value: saved });
  const firstAttempt = join(
    projectPath,
    ".planner",
    "generation",
    generated.jobId,
    "normalized-attempt-0",
  );
  mkdirSync(firstAttempt, { recursive: true });
  writeFileSync(join(firstAttempt, "model.glb"), "first attempt");
  return {
    generated,
    record,
    jobsPath,
    firstAttempt,
    asset: join(projectPath, "assets", record.assetId),
    sizeMismatches,
  };
}

test("a retry that cannot run publishes the first attempt with its size differences", async () => {
  const fixture = buildFixture();
  const prepared = await prepareFirstAttempt({ fixture });
  const queue = fixture.queue();
  try {
    await queue.resume();
    await vi.waitFor(() =>
      expect(
        queue.list().find((job) => job.id === prepared.generated.jobId)?.stage,
      ).toBe("ready"),
    );
    expect(readFileSync(join(prepared.asset, "model.glb"), "utf8")).toBe(
      "first attempt",
    );
    expect(existsSync(prepared.firstAttempt)).toBe(false);
    expect(
      fixture.store.loadProject(fixture.project.id).scene.items.at(0),
    ).toMatchObject({
      model: { kind: "asset", assetId: prepared.record.assetId },
      sizeM: { width: 1, height: 0.49, depth: 1 },
    });
    expect(
      GenerationRecordSchema.array()
        .parse(JSON.parse(readFileSync(prepared.jobsPath, "utf8")))
        .find((record) => record.job.id === prepared.generated.jobId)
        ?.sizeMismatches,
    ).toEqual(prepared.sizeMismatches);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("a removed item never receives the first attempt", async () => {
  const fixture = buildFixture();
  const prepared = await prepareFirstAttempt({ fixture });
  fixture.store.applyCommand({
    projectId: fixture.project.id,
    requestId: undefined,
    command: { type: "item.remove", itemId: prepared.generated.itemId },
  });
  const queue = fixture.queue();
  try {
    await queue.resume();
    await vi.waitFor(() =>
      expect(
        queue.list().find((job) => job.id === prepared.generated.jobId)?.stage,
      ).toBe("failed"),
    );
    expect(existsSync(prepared.asset)).toBe(false);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});

test("generation.start discards the first attempt", async () => {
  const fixture = buildFixture();
  const prepared = await prepareFirstAttempt({ fixture });
  const saved = GenerationRecordSchema.array().parse(
    JSON.parse(readFileSync(prepared.jobsPath, "utf8")),
  );
  for (const record of saved)
    record.job = { ...record.job, stage: "failed", error: "Stopped" };
  writeJson({ path: prepared.jobsPath, value: saved });
  const queue = fixture.queue();
  try {
    await queue.resume();
    queue.start({
      projectId: fixture.project.id,
      itemId: prepared.generated.itemId,
    });
    expect(existsSync(prepared.firstAttempt)).toBe(false);
    await vi.waitFor(() =>
      expect(
        queue.list().find((job) => job.id === prepared.generated.jobId)?.stage,
      ).toBe("failed"),
    );
    expect(existsSync(prepared.asset)).toBe(false);
  } finally {
    await queue.stopAll();
    fixture.close();
  }
});
