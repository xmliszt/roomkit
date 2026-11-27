import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ItemSourcesResultSchema } from "@planner/shared/src/protocol/item-sources-result-schema.ts";
import { ObjectsLibraryResultSchema } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import sharp from "sharp";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "../generation/generation-record-schema.ts";
import { readRegenerationSource } from "../generation/read-regeneration-source.ts";
import { InventoryRecordSchema } from "../inventory/inventory-record-schema.ts";
import { writeJson } from "../util/write-json.ts";

let fixture: Awaited<ReturnType<typeof createTestFixture>>;
let browser: Awaited<ReturnType<typeof fixture.connectBrowser>>;
let project: ReturnType<typeof fixture.daemon.store.createProject>;
let folder: string;

beforeEach(async () => {
  fixture = await createTestFixture();
  project = fixture.daemon.store.createProject({
    name: "Source room",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  folder = fixture.daemon.store.projectPath(project.id);
  browser = await fixture.connectBrowser();
  await browser.frame("snapshot");
});

afterEach(async () => {
  await fixture.close();
});

async function command(input: { type: string; [key: string]: unknown }) {
  const ack = CommandAckSchema.parse(
    await browser.command({ projectId: project.id, ...input }),
  );
  if (!ack.ok) throw new Error(ack.error);
  return ack.result;
}

function request(path: string) {
  return fetch(`http://127.0.0.1:${fixture.address.port}${path}`, {
    headers: { origin: TEST_WEB_ORIGIN },
  });
}

function item(options: { id: string; assetId?: string }) {
  const value = ItemSchema.parse({
    id: options.id,
    name: `${options.id} name`,
    model: options.assetId
      ? { kind: "asset", assetId: options.assetId }
      : { kind: "pending", jobId: `job-${options.id}` },
    sizeM: { width: 1, height: 1, depth: 1 },
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    locked: false,
  });
  fixture.daemon.store.applyCommand({
    projectId: project.id,
    requestId: undefined,
    command: { type: "item.add", item: value },
  });
  return value;
}

function record(options: {
  item: ReturnType<typeof item>;
  source: GenerationRecord["source"];
  assetId?: string;
  createdAt?: string;
}) {
  const now = options.createdAt ?? "2026-11-23T00:00:00.000Z";
  return GenerationRecordSchema.parse({
    job: {
      id:
        options.item.model.kind === "pending"
          ? options.item.model.jobId
          : randomUUID(),
      kind: "generation",
      projectId: project.id,
      itemId: options.item.id,
      stage: "held",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    },
    item: options.item,
    source: options.source,
    prompt: "Build the object",
    held: true,
    attempt: 0,
    assetId: options.assetId ?? `asset-${options.item.id}`,
  });
}

function saveRecords(records: unknown[]) {
  writeJson({ path: join(folder, ".planner", "jobs.json"), value: records });
}

async function photo(options: { id: string; origin?: "capture" | "chat" }) {
  for (const name of ["upright", "vision"])
    mkdirSync(join(folder, "photos", name), { recursive: true });
  const bytes = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: "#0000ff" },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 500,
            height: 300,
            channels: 3,
            background: "#ff0000",
          },
        })
          .png()
          .toBuffer(),
        left: 250,
        top: 100,
      },
    ])
    .jpeg()
    .toBuffer();
  writeFileSync(join(folder, "photos", "upright", `${options.id}.jpg`), bytes);
  await sharp(bytes)
    .resize(100, 50)
    .jpeg()
    .toFile(join(folder, "photos", "vision", `${options.id}.jpg`));
  const manifestPath = join(folder, "photos", "photos.json");
  const previous = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).photos
    : [];
  writeJson({
    path: manifestPath,
    value: {
      version: 1,
      photos: [
        ...previous,
        {
          photoId: options.id,
          sourceFileName: `${options.id}.jpg`,
          origin: options.origin ?? "capture",
          widthPx: 1000,
          heightPx: 500,
          orientation: 1,
          blurScore: 100,
          kind: "accepted",
          uprightPath: `upright/${options.id}.jpg`,
          visionPath: `vision/${options.id}.jpg`,
          visionWidthPx: 100,
          visionHeightPx: 50,
        },
      ],
    },
  });
}

function asset(options: {
  id: string;
  source?: GenerationRecord["source"];
  kind?: "variant";
  createdAt?: string;
  method?: string;
}) {
  const path = join(folder, "assets", options.id);
  mkdirSync(path, { recursive: true });
  writeJson({
    path: join(path, "meta.json"),
    value: AssetMetaSchema.parse({
      id: options.id,
      kind: options.kind ?? "generated",
      nativeSizeM: { width: 1, height: 2, depth: 3 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      ...(options.source?.kind === "color" || options.source?.kind === "shape"
        ? { parentAssetId: options.source.parentAssetId }
        : {}),
      provenance: { method: options.method ?? "modeler", sourcePhotoIds: [] },
    }),
  });
  writeFileSync(join(path, "model.glb"), "model bytes");
  writeFileSync(join(path, "thumb.png"), "thumbnail bytes");
  if (options.createdAt)
    utimesSync(
      join(path, "meta.json"),
      new Date(options.createdAt),
      new Date(options.createdAt),
    );
  if (options.source) {
    mkdirSync(join(path, "source"));
    writeJson({
      path: join(path, "source", "job.json"),
      value: {
        reference: options.source,
        photos: ["photos/reference.jpg"],
        masks: [],
      },
    });
  }
  return path;
}

test("inventory sources include every boxed view, normalized best-first, with padded JPEG crops and a disk cache", async () => {
  await photo({ id: "front" });
  await photo({ id: "side" });
  const table = item({ id: "table" });
  const inventoryId = "inventory";
  const source = {
    kind: "inventory",
    inventoryJobId: inventoryId,
    object: {
      objectId: "table-object",
      name: "Table",
      mount: "floor",
      bestPhotoId: "front",
      views: [
        { photoId: "side", box: [0, 0, 100, 50], visibility: "mostly-visible" },
        {
          photoId: "front",
          box: [25, 10, 75, 40],
          visibility: "mostly-visible",
        },
      ],
    },
  };
  const generation = record({
    item: table,
    source: GenerationRecordSchema.shape.source.parse(source),
  });
  const inventory = InventoryRecordSchema.parse({
    job: {
      id: inventoryId,
      kind: "inventory",
      projectId: project.id,
      reconstructionJobId: "recon",
      stage: "done",
      progress: 1,
      createdAt: generation.job.createdAt,
      updatedAt: generation.job.updatedAt,
    },
    photoIds: ["front", "side"],
    scenePath: "scene.npz",
    camerasPath: "cameras.json",
    room: project.scene.room,
    submission: [source.object],
    outcome: {
      objectIds: [source.object.objectId],
      items: [table],
      generationJobs: [{ ...generation.job, id: "job-table", stage: "queued" }],
      undo: [],
      blocks: [],
    },
  });
  saveRecords([inventory]);
  const result = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources", itemId: table.id }),
  );
  expect(result.items).toHaveLength(1);
  expect(result.items.at(0)?.origin).toBe("inventory");
  const views = result.items.at(0)?.photos;
  expect(views?.map((view) => view.kind === "photo" && view.photoId)).toEqual([
    "front",
    "side",
  ]);
  const best = views?.at(0);
  expect(best).toMatchObject({
    kind: "photo",
    photoId: "front",
    box: [0.25, 0.2, 0.75, 0.8],
    isBest: true,
  });
  expect(views?.at(1)?.isBest).toBe(false);
  if (best?.kind !== "photo" || !best.cropUrl)
    throw new Error("Missing crop URL");
  const crop = await request(best.cropUrl);
  expect(crop.status).toBe(200);
  expect(crop.headers.get("content-type")).toBe("image/jpeg");
  const bytes = Buffer.from(await crop.arrayBuffer());
  expect(await sharp(bytes).metadata()).toMatchObject({
    width: 256,
    height: 154,
    format: "jpeg",
  });
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data.at(2)).toBeGreaterThan(200);
  const centre =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
    info.channels;
  expect(data.at(centre)).toBeGreaterThan(200);
  const cache = join(folder, ".planner", "crops");
  const cachedPath = join(cache, readdirSync(cache).at(0) ?? "missing");
  const stamp = new Date("2000-01-01T00:00:00.000Z");
  utimesSync(cachedPath, stamp, stamp);
  expect(
    Buffer.from(await (await request(best.cropUrl)).arrayBuffer()),
  ).toEqual(bytes);
  expect(statSync(cachedPath).mtime.toISOString()).toBe(stamp.toISOString());
  expect(readdirSync(cache)).toHaveLength(1);
  for (const size of [64, 1024]) {
    const response = await request(
      best.cropUrl.replace("size=256", `size=${size}`),
    );
    expect(
      (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width,
    ).toBe(size);
  }
});

test("photos added by a regeneration follow the inventory views and skip unavailable photos", async () => {
  await photo({ id: "front" });
  await photo({ id: "chat", origin: "chat" });
  const table = item({ id: "table", assetId: "asset-table" });
  const source = GenerationRecordSchema.shape.source.parse({
    kind: "inventory",
    inventoryJobId: "inventory",
    object: {
      objectId: "table-object",
      name: "Table",
      mount: "floor",
      bestPhotoId: "front",
      views: [
        {
          photoId: "front",
          box: [25, 10, 75, 40],
          visibility: "mostly-visible",
        },
      ],
    },
  });
  const original = record({ item: table, source, assetId: "asset-table" });
  const regeneration = {
    ...record({ item: table, source, assetId: "asset-next" }),
    source: { ...source, extraPhotoIds: ["chat", "deleted"] },
    regeneration: {},
  };
  saveRecords([original, regeneration]);
  const result = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources", itemId: table.id }),
  );
  expect(
    result.items
      .at(0)
      ?.photos.map((view) =>
        view.kind === "photo" ? [view.photoId, view.isBest, view.box] : [],
      ),
  ).toEqual([
    ["front", true, [0.25, 0.2, 0.75, 0.8]],
    ["chat", false, undefined],
  ]);
});

test("chat, web, prompt, variant and catalog sources follow the saved generation reference", async () => {
  await photo({ id: "chat-photo", origin: "chat" });
  const chat = item({ id: "chat" });
  const web = item({ id: "web", assetId: "web-model" });
  const prompt = item({ id: "prompt", assetId: "prompt-model" });
  const variant = item({ id: "variant", assetId: "variant-model" });
  const catalog = item({ id: "socket", assetId: "charging-port" });
  const reference = {
    kind: "web",
    imageUrl: "https://example.invalid/image.jpg",
    sourceUrl: "https://example.invalid/product",
  };
  const webPath = asset({
    id: "web-model",
    source: GenerationRecordSchema.shape.source.parse(reference),
  });
  const image = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#ff0000" },
  })
    .jpeg()
    .toBuffer();
  mkdirSync(join(webPath, "source", "photos"));
  writeFileSync(join(webPath, "source", "photos", "reference.jpg"), image);
  asset({ id: "prompt-model" });
  asset({
    id: "variant-model",
    source: { kind: "shape", parentAssetId: "web-model" },
    kind: "variant",
  });
  saveRecords([
    record({ item: chat, source: { kind: "photo", photoId: "chat-photo" } }),
  ]);
  const result = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources" }),
  );
  expect(result.items.map((entry) => [entry.itemId, entry.origin])).toEqual([
    [chat.id, "chat-photo"],
    [web.id, "web"],
    [prompt.id, "prompt"],
    [variant.id, "variant"],
    [catalog.id, "catalog"],
  ]);
  expect(
    result.items.find((entry) => entry.itemId === chat.id)?.photos,
  ).toEqual([{ kind: "photo", photoId: "chat-photo", isBest: true }]);
  const webSource = result.items
    .find((entry) => entry.itemId === web.id)
    ?.photos.at(0);
  expect(webSource).toEqual({
    kind: "web",
    imageUrl: `/projects/${project.id}/items/web/sources/0`,
    sourceUrl: reference.sourceUrl,
    isBest: true,
  });
  if (webSource?.kind !== "web") throw new Error("Missing web source");
  expect(
    Buffer.from(await (await request(webSource.imageUrl)).arrayBuffer()),
  ).toEqual(image);
  expect(
    result.items.find((entry) => entry.itemId === prompt.id)?.photos,
  ).toEqual([]);
  expect(
    result.items.find((entry) => entry.itemId === variant.id)?.photos,
  ).toEqual([]);
  const other = fixture.daemon.store.createProject({
    name: "Other room",
    room: { widthM: 4, depthM: 4, ceilingHeightM: 3 },
  });
  expect(
    (await request(`/projects/${other.id}/items/web/sources/0`)).status,
  ).toBe(404);
  for (const index of ["-1", "1", "1.2", "9007199254740992", "nope"])
    expect(
      (await request(`/projects/${project.id}/items/web/sources/${index}`))
        .status,
    ).toBe(404);
  rmSync(join(webPath, "source", "photos", "reference.jpg"));
  expect((await request(webSource.imageUrl)).status).toBe(404);
});

test("uses the current asset's producing record and traces colour variants to the parent's original photos", async () => {
  await photo({ id: "old" });
  await photo({ id: "latest" });
  const original = item({ id: "original", assetId: "original-model" });
  item({ id: "colour", assetId: "colour-model" });
  asset({ id: "original-model", source: { kind: "photo", photoId: "old" } });
  const colorSource = {
    kind: "color",
    parentAssetId: "original-model",
    color: "#ffffff",
    strength: 1,
    referenceLuma: 0.5,
    nativeSizeM: original.sizeM,
  };
  asset({
    id: "colour-model",
    source: GenerationRecordSchema.shape.source.parse(colorSource),
    kind: "variant",
  });
  const older = record({
    item: original,
    source: { kind: "photo", photoId: "old" },
    assetId: "original-model",
  });
  const latest = record({
    item: original,
    source: { kind: "photo", photoId: "latest" },
    assetId: "replacement",
    createdAt: "2026-11-23T01:00:00.000Z",
  });
  saveRecords([latest, older]);
  const sources = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources" }),
  ).items;
  expect(sources.find((entry) => entry.itemId === "original")?.photos).toEqual([
    { kind: "photo", photoId: "old", isBest: true },
  ]);
  expect(sources.find((entry) => entry.itemId === "colour")).toMatchObject({
    origin: "variant",
    photos: [{ kind: "photo", photoId: "old", isBest: true }],
  });
});

test.each(["modeler", "trellis2", "sam3d"])(
  "%s parents cannot be archived while imported colour variants depend on them",
  async (method) => {
    const parentSource = {
      kind: "web",
      imageUrl: "https://example.invalid/image.jpg",
      sourceUrl: "https://example.invalid/product",
    };
    const parentPath = asset({
      id: "parent",
      source: GenerationRecordSchema.shape.source.parse(parentSource),
      method,
    });
    const bytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#00ff00" },
    })
      .jpeg()
      .toBuffer();
    mkdirSync(join(parentPath, "source", "photos"));
    writeFileSync(join(parentPath, "source", "photos", "reference.jpg"), bytes);
    const variant = item({ id: "variant", assetId: "variant-model" });
    asset({
      id: "variant-model",
      kind: "variant",
      source: {
        kind: "color",
        parentAssetId: "parent",
        color: "#ffffff",
        strength: 1,
        referenceLuma: 0.5,
        nativeSizeM: variant.sizeM,
      },
    });
    const before = ItemSourcesResultSchema.parse(
      await command({ type: "item.sources", itemId: variant.id }),
    );
    const source = before.items.at(0)?.photos.at(0);
    expect(before.items.at(0)?.origin).toBe("variant");
    if (source?.kind !== "web")
      throw new Error("Missing imported variant source");
    expect(
      Buffer.from(await (await request(source.imageUrl)).arrayBuffer()),
    ).toEqual(bytes);
    await expect(
      command({ type: "objects.archive", assetId: "parent" }),
    ).rejects.toThrow("depend on this model");
    expect(await command({ type: "item.sources", itemId: variant.id })).toEqual(
      before,
    );
    expect(
      Buffer.from(await (await request(source.imageUrl)).arrayBuffer()),
    ).toEqual(bytes);
    const regenerated = readRegenerationSource({
      projectFolder: folder,
      item: variant,
      previous: undefined,
      records: [],
    });
    expect(regenerated).toMatchObject({
      source: parentSource,
    });
    expect(regenerated.sourcePath).toBe(
      method === "modeler" ? join("assets", "parent", "source") : undefined,
    );
    expect(await command({ type: "item.sources", itemId: variant.id })).toEqual(
      before,
    );
  },
);

test.each(["trellis2", "sam3d"])(
  "imported %s alternatives serve their saved web image without generation history",
  async (method) => {
    const reference = {
      kind: "web",
      imageUrl: "https://example.invalid/image.jpg",
      sourceUrl: "https://example.invalid/product",
    };
    const path = asset({
      id: "alternative",
      source: GenerationRecordSchema.shape.source.parse(reference),
      method,
    });
    const bytes = await sharp({
      create: { width: 30, height: 20, channels: 3, background: "#00ff00" },
    })
      .jpeg()
      .toBuffer();
    mkdirSync(join(path, "source", "photos"));
    writeFileSync(join(path, "source", "photos", "reference.jpg"), bytes);
    const alternative = item({ id: "alternative", assetId: "alternative" });
    const result = ItemSourcesResultSchema.parse(
      await command({ type: "item.sources", itemId: alternative.id }),
    );
    const source = result.items.at(0)?.photos.at(0);
    if (source?.kind !== "web") throw new Error("Missing web reference");
    const response = await request(source.imageUrl);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  },
);

test("held colour variants retain variant origin while showing the parent's photo", async () => {
  await photo({ id: "reference" });
  const parent = item({ id: "parent", assetId: "parent-model" });
  asset({
    id: "parent-model",
    source: { kind: "photo", photoId: "reference" },
  });
  const held = item({ id: "held" });
  const generation = record({
    item: held,
    source: {
      kind: "color",
      parentAssetId: "parent-model",
      color: "#ffffff",
      strength: 1,
      referenceLuma: 0.5,
      nativeSizeM: parent.sizeM,
    },
  });
  saveRecords([generation]);
  const result = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources", itemId: held.id }),
  );
  expect(result.items).toEqual([
    {
      itemId: held.id,
      origin: "variant",
      photos: [{ kind: "photo", photoId: "reference", isBest: true }],
    },
  ]);
});

test("rejects unknown ids, invalid crop coordinates and sizes, and unauthorized HTTP requests", async () => {
  await photo({ id: "photo" });
  const base = `/projects/${project.id}/photos/photo/crop`;
  for (const query of [
    "",
    "box=0,0,2,1",
    "box=-0.1,0,1,1",
    "box=0,0,1,1&size=5000",
    "box=0,0,1,1&size=63",
    "box=0,0,1,1&size=1.5",
    "box=0,0,1,1&size=NaN",
    "box=0,0,0,1",
    "box=0,1,1,0",
    "box=0,,1,1",
    "box=0,0,Infinity,1",
    "box=0,0,1",
  ])
    expect((await request(`${base}?${query}`)).status, query).toBe(400);
  for (const path of [
    `${base.replace("/photo/", "/missing/")}?box=0,0,1,1`,
    `${base.replace(project.id, "bad")}?box=0,0,1,1`,
    `${base.replace("/photo/", "/..%2Foutside/")}?box=0,0,1,1`,
  ])
    expect((await request(path)).status).toBe(404);
  const noAuth = await fetch(
    `http://127.0.0.1:${fixture.address.port}${base}?box=0,0,1,1`,
  );
  expect(noAuth.status).toBe(401);
  expect(
    (
      await fetch(
        `http://127.0.0.1:${fixture.address.port}${base}?box=0,0,1,1`,
        { headers: { origin: "https://untrusted.invalid" } },
      )
    ).status,
  ).toBe(403);
  for (const input of [
    { type: "item.sources", itemId: "../bad" },
    { type: "objects.archive", assetId: "../bad" },
    { type: "objects.restore", assetId: "__proto__" },
    { type: "objects.library", projectId: "bad" },
    { type: "item.sources", itemId: "missing" },
    { type: "objects.library", projectId: randomUUID() },
  ])
    expect(
      CommandAckSchema.parse(
        await browser.command({ projectId: project.id, ...input }),
      ).ok,
    ).toBe(false);
});

test("library includes placed and unused models, excludes surfaces and pending items, and archives without losing files", async () => {
  asset({ id: "placed", createdAt: "2026-11-24T00:00:00.000Z" });
  asset({ id: "alternative", createdAt: "2026-11-23T02:00:00.000Z" });
  asset({ id: "imported", createdAt: "2026-11-22T00:00:00.000Z" });
  const placed = item({ id: "one", assetId: "placed" });
  item({ id: "two", assetId: "placed" });
  item({ id: "pending" });
  item({ id: "socket", assetId: "charging-port" });
  const unused = record({
    item: placed,
    assetId: "alternative",
    source: {
      kind: "web",
      imageUrl: "https://example.invalid/image.jpg",
      sourceUrl: "https://example.invalid/product",
    },
  });
  unused.item.name = "Unused alternative";
  unused.job.createdAt = "2026-11-23T03:00:00.000Z";
  saveRecords([unused]);
  mkdirSync(join(folder, "assets", "wall-texture"));
  writeJson({
    path: join(folder, "assets", "wall-texture", "meta.json"),
    value: { id: "wall-texture", kind: "surface" },
  });
  const library = ObjectsLibraryResultSchema.parse(
    await command({ type: "objects.library" }),
  );
  expect(
    library.objects
      .filter((entry) => !entry.builtIn)
      .map((entry) => entry.assetId),
  ).toEqual(["placed", "alternative", "imported"]);
  expect(
    library.objects.find((entry) => entry.assetId === "placed"),
  ).toMatchObject({
    name: "one name",
    mount: "floor",
    itemIds: ["one", "two"],
  });
  expect(
    library.objects.find((entry) => entry.assetId === "alternative"),
  ).toMatchObject({
    name: "Unused alternative",
    origin: "web",
    itemIds: [],
    createdAt: unused.job.createdAt,
  });
  expect(
    library.objects.find((entry) => entry.assetId === "imported"),
  ).toMatchObject({
    name: "Untitled model",
    createdAt: "2026-11-22T00:00:00.000Z",
  });
  expect(
    library.objects
      .filter((entry) => entry.builtIn)
      .map((entry) => entry.assetId)
      .toSorted(),
  ).toEqual(CHARGING_PORT_TYPES.map((entry) => entry.assetId).toSorted());
  expect(
    library.objects.find((entry) => entry.assetId === "charging-port")?.itemIds,
  ).toEqual(["socket"]);
  expect(
    CommandAckSchema.parse(
      await browser.command({
        type: "objects.archive",
        projectId: project.id,
        assetId: "placed",
      }),
    ).ok,
  ).toBe(false);
  for (const assetId of ["charging-port", "wall-texture", "missing"])
    expect(
      CommandAckSchema.parse(
        await browser.command({
          type: "objects.archive",
          projectId: project.id,
          assetId,
        }),
      ).ok,
    ).toBe(false);
  expect(
    await command({ type: "objects.archive", assetId: "alternative" }),
  ).toEqual({ assetId: "alternative" });
  expect(existsSync(join(folder, "assets", "alternative"))).toBe(false);
  expect(
    readFileSync(
      join(folder, ".planner", "archive", "alternative", "model.glb"),
      "utf8",
    ),
  ).toBe("model bytes");
  expect(
    ObjectsLibraryResultSchema.parse(
      await command({ type: "objects.library" }),
    ).objects.some((entry) => entry.assetId === "alternative"),
  ).toBe(false);
  expect(
    await command({ type: "objects.restore", assetId: "alternative" }),
  ).toEqual({ assetId: "alternative" });
  expect(
    ObjectsLibraryResultSchema.parse(
      await command({ type: "objects.library" }),
    ).objects.find((entry) => entry.assetId === "alternative"),
  ).toEqual(library.objects.find((entry) => entry.assetId === "alternative"));
  expect(
    readFileSync(join(folder, "assets", "alternative", "model.glb"), "utf8"),
  ).toBe("model bytes");
});

test("refuses source and cache symlinks that leave the project and never archives an external asset", async () => {
  await photo({ id: "photo" });
  const outside = join(fixture.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "photo.jpg"), "private bytes");
  const photoPath = join(folder, "photos", "upright", "photo.jpg");
  rmSync(photoPath);
  symlinkSync(join(outside, "photo.jpg"), photoPath);
  expect(
    (await request(`/projects/${project.id}/photos/photo/crop?box=0,0,1,1`))
      .status,
  ).toBe(404);
  symlinkSync(outside, join(folder, "assets", "external"));
  expect(
    ObjectsLibraryResultSchema.parse(
      await command({ type: "objects.library" }),
    ).objects.some((entry) => entry.assetId === "external"),
  ).toBe(false);
  expect(
    CommandAckSchema.parse(
      await browser.command({
        type: "objects.archive",
        projectId: project.id,
        assetId: "external",
      }),
    ).ok,
  ).toBe(false);
  expect(existsSync(outside)).toBe(true);
});
