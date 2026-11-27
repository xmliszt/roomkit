import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import sharp from "sharp";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { readItemSources } from "../objects/read-item-sources.ts";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { createGenerationQueue } from "./create-generation-queue.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "./generation-record-schema.ts";

const PHOTO_IDS = ["front", "side", "back", "detail"];

async function setup() {
  const fixture = await createTestFixture({
    env: (root) => ({ PLANNER_CLAUDE_BIN: join(root, "failing-claude") }),
  });
  const { store, chat, bus } = fixture.daemon;
  const project = store.createProject({
    name: "Multi photo",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
  });
  const folder = store.projectPath(project.id);
  writeFileSync(
    fixture.env.PLANNER_CLAUDE_BIN,
    `#!${process.execPath}\nimport { runFakeCli } from ${JSON.stringify(pathToFileURL(resolve("test/fake-cli/run-fake-cli.mjs")).href)};\nawait runFakeCli({kind:"claude",scenario:{steps:[{kind:"error",message:"modeler stopped"}]}});\n`,
    { mode: 0o755 },
  );
  mkdirSync(join(fixture.root, "tools"), { recursive: true });
  writeFileSync(
    join(fixture.root, "tools/blender"),
    '#!/bin/sh\necho "Blender 5.3.0"\n',
    { mode: 0o755 },
  );
  for (const name of ["upright", "vision"]) {
    mkdirSync(join(folder, "photos", name), { recursive: true });
    for (const photoId of PHOTO_IDS)
      await sharp({
        create: { width: 512, height: 512, channels: 3, background: "#808080" },
      })
        .jpeg()
        .toFile(join(folder, "photos", name, `${photoId}.jpg`));
  }
  writeJson({
    path: join(folder, "photos/photos.json"),
    value: {
      version: 1,
      photos: PHOTO_IDS.map((photoId) => ({
        photoId,
        origin: "chat",
        sourceFileName: `${photoId}.png`,
        widthPx: 512,
        heightPx: 512,
        orientation: 1,
        blurScore: 1,
        kind: "accepted",
        uprightPath: `upright/${photoId}.jpg`,
        visionPath: `vision/${photoId}.jpg`,
        visionWidthPx: 512,
        visionHeightPx: 512,
      })),
    },
  });
  const runtime = createAgentRuntime({ env: fixture.env });
  const generation = createGenerationQueue({
    store,
    chat,
    bus,
    runtime,
    env: fixture.env,
    logger: createLogger(),
    config: createDefaultConfig,
    plannerHome: fixture.env.PLANNER_HOME,
    agentSlots: createTurnSlots({ size: 2 }),
    workerSlots: createTurnSlots({ size: 1 }),
    link: () => ({ token: "unused", wsUrl: "ws://127.0.0.1:1" }),
    allowedHosts: [],
  });
  async function waitForFailure(jobId: string) {
    await vi.waitFor(
      () =>
        expect(generation.list().find((job) => job.id === jobId)?.stage).toBe(
          "failed",
        ),
      { timeout: 10000 },
    );
  }
  function readJob(jobId: string) {
    return z
      .object({
        photos: z.array(z.string()),
        bestPhoto: z.string(),
        reference: z.unknown(),
        masks: z.array(z.string()),
      })
      .parse(
        JSON.parse(
          readFileSync(
            join(folder, ".planner", "generation", jobId, "job.json"),
            "utf8",
          ),
        ),
      );
  }
  async function close() {
    await generation.stopAll();
    runtime.killAll();
    await fixture.close();
  }
  function heldRecord(input: {
    itemId: string;
    source: GenerationRecord["source"];
  }) {
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const item = {
      id: input.itemId,
      name: input.itemId,
      sizeM: { width: 1, height: 1, depth: 1 },
      placement: {
        kind: "floor",
        xM: 0,
        zM: 0,
        elevationM: 0,
        rotationRad: 0,
      },
      locked: false,
      model: { kind: "pending", jobId },
    } satisfies GenerationRecord["item"];
    store.applyCommand({
      projectId: project.id,
      requestId: undefined,
      command: { type: "item.add", item },
    });
    store.flush();
    return GenerationRecordSchema.parse({
      job: {
        id: jobId,
        kind: "generation",
        projectId: project.id,
        itemId: item.id,
        stage: "held",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      item,
      source: input.source,
      prompt: `Build ${item.name}`,
      held: true,
      attempt: 0,
      assetId: crypto.randomUUID(),
    });
  }
  return {
    store,
    project,
    heldRecord,
    folder,
    generation,
    waitForFailure,
    readJob,
    close,
  };
}

test("a 3-photo generation copies every photo, primary first, and regenerate photoIds reach the next jobs", async () => {
  const context = await setup();
  try {
    const { jobId, itemId } = context.generation.generate({
      projectId: context.project.id,
      spec: {
        name: "Bean bag",
        prompt: "Bean bag sofa",
        reference: {
          kind: "photo",
          photoId: "side",
          extraPhotoIds: ["front", "back"],
        },
        sizeM: { width: 1, height: 0.8, depth: 1 },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    });
    await context.waitForFailure(jobId);
    const first = context.readJob(jobId);
    expect(first.photos).toEqual([
      "photos/side.jpg",
      "photos/front.jpg",
      "photos/back.jpg",
    ]);
    expect(first.bestPhoto).toBe("photos/side.jpg");
    for (const photo of first.photos)
      expect(
        readFileSync(
          join(context.folder, ".planner", "generation", jobId, photo),
        ).length,
      ).toBeGreaterThan(0);

    const sources = readItemSources({
      folder: context.folder,
      project: context.store.loadProject(context.project.id),
      itemId,
    });
    expect(sources.items.at(0)?.photos).toEqual([
      { kind: "photo", photoId: "side", isBest: true },
      { kind: "photo", photoId: "front", isBest: false },
      { kind: "photo", photoId: "back", isBest: false },
    ]);

    const regenerated = context.generation.regenerate({
      projectId: context.project.id,
      itemId,
      notes: "Rounder back",
      photoIds: ["detail", "front"],
    });
    expect(
      readItemSources({
        folder: context.folder,
        project: context.store.loadProject(context.project.id),
        itemId,
      }).items.at(0)?.photos,
    ).toHaveLength(4);
    expect(
      context.generation.regenerate({
        projectId: context.project.id,
        itemId,
        notes: "Rounder back",
        photoIds: ["front", "detail"],
      }),
    ).toEqual(regenerated);
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId,
        notes: "Rounder back",
        photoIds: ["back", "detail"],
        primaryPhotoId: "back",
      }),
    ).toThrow("already has an active generation job");
    await context.waitForFailure(regenerated.jobId);
    expect(
      readItemSources({
        folder: context.folder,
        project: context.store.loadProject(context.project.id),
        itemId,
      })
        .items.at(0)
        ?.photos.map((photo) =>
          photo.kind === "photo" ? photo.photoId : photo.kind,
        ),
    ).toEqual(["side", "front", "back", "detail"]);
    expect(context.readJob(regenerated.jobId)).toMatchObject({
      reference: {
        kind: "photo",
        photoId: "side",
        extraPhotoIds: ["front", "back", "detail"],
      },
      photos: [
        "photos/side.jpg",
        "photos/front.jpg",
        "photos/back.jpg",
        "photos/detail.jpg",
      ],
    });

    const alternative = context.generation.alternatives({
      projectId: context.project.id,
      itemId,
      method: "trellis2",
    });
    expect(
      z
        .array(
          z.object({
            job: z.object({ id: z.string() }).passthrough(),
            source: z.unknown(),
          }),
        )
        .parse(
          JSON.parse(
            readFileSync(join(context.folder, ".planner", "jobs.json"), "utf8"),
          ),
        )
        .find((record) => record.job.id === alternative.jobIds.at(0))?.source,
    ).toEqual({
      kind: "photo",
      photoId: "side",
      extraPhotoIds: ["front", "back", "detail"],
    });
    await context.waitForFailure(alternative.jobIds.at(0) ?? "");

    const next = context.generation.regenerate({
      projectId: context.project.id,
      itemId,
      notes: "Lower seat",
      primaryPhotoId: "detail",
    });
    await context.waitForFailure(next.jobId);
    expect(context.readJob(next.jobId)).toMatchObject({
      reference: {
        kind: "photo",
        photoId: "detail",
        extraPhotoIds: ["side", "front", "back"],
      },
      photos: [
        "photos/detail.jpg",
        "photos/side.jpg",
        "photos/front.jpg",
        "photos/back.jpg",
      ],
    });
  } finally {
    await context.close();
  }
});

test("regenerate refuses unknown photos, a primary outside the object's photos and photos for a web source", async () => {
  const context = await setup();
  try {
    const photo = context.generation.generate({
      projectId: context.project.id,
      spec: {
        name: "Chair",
        prompt: "Chair",
        reference: { kind: "photo", photoId: "front" },
        sizeM: { width: 1, height: 1, depth: 1 },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    });
    await context.waitForFailure(photo.jobId);
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId: photo.itemId,
        photoIds: ["missing"],
      }),
    ).toThrow("Photo is not available in this project: missing");
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId: photo.itemId,
        primaryPhotoId: "gone",
      }),
    ).toThrow("Photo is not available in this project: gone");
    expect(() =>
      context.generation.generate({
        projectId: context.project.id,
        spec: {
          name: "Chair",
          prompt: "Chair",
          reference: {
            kind: "photo",
            photoId: "front",
            extraPhotoIds: ["sdie"],
          },
          sizeM: { width: 1, height: 1, depth: 1 },
          placement: {
            kind: "floor",
            xM: 0,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
        },
      }),
    ).toThrow("Photo is not available in this project: sdie");
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId: photo.itemId,
        photoIds: ["side"],
        primaryPhotoId: "back",
      }),
    ).toThrow("primaryPhotoId must be one of");

    const web = context.generation.generate({
      projectId: context.project.id,
      spec: {
        name: "Lamp",
        prompt: "Lamp",
        reference: {
          kind: "web",
          imageUrl: "https://unreachable.invalid/lamp.jpg",
          sourceUrl: "https://unreachable.invalid",
        },
        sizeM: { width: 0.3, height: 1.5, depth: 0.3 },
        placement: {
          kind: "floor",
          xM: 1,
          zM: 1,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    });
    await context.waitForFailure(web.jobId);
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId: web.itemId,
        photoIds: ["side"],
      }),
    ).toThrow("Photos can be added only");
  } finally {
    await context.close();
  }
});

test("a held inventory job merges regenerate photoIds before it starts, and a held colour job refuses them", async () => {
  const context = await setup();
  try {
    const inventoryJobId = "inventory";
    const maskFolder = join(
      context.folder,
      ".planner",
      "inventory",
      inventoryJobId,
      "masks",
    );
    mkdirSync(maskFolder, { recursive: true });
    await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#ffffff" },
    })
      .png()
      .toFile(join(maskFolder, "front.png"));
    writeJson({
      path: join(maskFolder, "masks.json"),
      value: {
        objects: [
          {
            objectId: "table",
            views: [{ photoId: "front", maskPath: "front.png" }],
          },
        ],
      },
    });
    const inventory = context.heldRecord({
      itemId: "table",
      source: {
        kind: "inventory",
        inventoryJobId,
        object: {
          objectId: "table",
          name: "Table",
          mount: "floor",
          bestPhotoId: "front",
          views: [
            {
              photoId: "front",
              box: [100, 100, 300, 300],
              visibility: "more-than-half-hidden",
            },
          ],
        },
      },
    });
    const colour = context.heldRecord({
      itemId: "red-table",
      source: {
        kind: "color",
        parentAssetId: "parent",
        color: "#ff0000",
        strength: 1,
        referenceLuma: 0.5,
        nativeSizeM: { width: 1, height: 1, depth: 1 },
      },
    });
    writeJson({
      path: join(context.folder, ".planner", "jobs.json"),
      value: [inventory, colour],
    });
    await context.generation.resume();
    expect(() =>
      context.generation.regenerate({
        projectId: context.project.id,
        itemId: "red-table",
        photoIds: ["detail"],
      }),
    ).toThrow("Photos can be added only");
    const started = context.generation.regenerate({
      projectId: context.project.id,
      itemId: "table",
      notes: "Add the chat view",
      photoIds: ["detail"],
    });
    expect(started.jobId).toBe(inventory.job.id);
    await context.waitForFailure(started.jobId);
    expect(context.readJob(started.jobId)).toMatchObject({
      photos: ["photos/front.jpg", "photos/detail.jpg"],
      masks: ["masks/front.png"],
      bestPhoto: "photos/front.jpg",
    });
    expect(
      z
        .array(
          z.object({
            job: z.object({ id: z.string() }).passthrough(),
            source: z
              .object({ extraPhotoIds: z.array(z.string()).optional() })
              .passthrough(),
          }),
        )
        .parse(
          JSON.parse(
            readFileSync(join(context.folder, ".planner", "jobs.json"), "utf8"),
          ),
        )
        .find((record) => record.job.id === inventory.job.id)?.source
        .extraPhotoIds,
    ).toEqual(["detail"]);
  } finally {
    await context.close();
  }
});
