import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ItemSourcesResultSchema } from "@planner/shared/src/protocol/item-sources-result-schema.ts";
import { ObjectsArchivedResultSchema } from "@planner/shared/src/protocol/objects-archived-result-schema.ts";
import { ObjectsLibraryResultSchema } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "../generation/generation-record-schema.ts";
import { writeJson } from "../util/write-json.ts";

let fixture: Awaited<ReturnType<typeof createTestFixture>>;
let browser: Awaited<ReturnType<typeof fixture.connectBrowser>>;
let project: ReturnType<typeof fixture.daemon.store.createProject>;
let folder: string;

beforeEach(async () => {
  fixture = await createTestFixture();
  project = fixture.daemon.store.createProject({
    name: "Reviewed library",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 3 },
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
function buildItem(options: { id: string; assetId?: string }) {
  return ItemSchema.parse({
    id: options.id,
    name: options.id,
    model: options.assetId
      ? { kind: "asset", assetId: options.assetId }
      : { kind: "pending", jobId: `job-${options.id}` },
    sizeM: { width: 1, height: 1, depth: 1 },
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    locked: false,
  });
}
function writeAsset(options: {
  id: string;
  parentAssetId?: string;
  reference?: unknown;
}) {
  const assetFolder = join(folder, "assets", options.id);
  mkdirSync(assetFolder, { recursive: true });
  writeJson({
    path: join(assetFolder, "meta.json"),
    value: {
      id: options.id,
      kind: options.parentAssetId ? "variant" : "generated",
      ...(options.parentAssetId
        ? { parentAssetId: options.parentAssetId }
        : {}),
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "modeler", sourcePhotoIds: [] },
    },
  });
  writeFileSync(join(assetFolder, "model.glb"), "model bytes");
  writeFileSync(join(assetFolder, "thumb.png"), "thumbnail bytes");
  if (options.reference) {
    mkdirSync(join(assetFolder, "source"));
    writeJson({
      path: join(assetFolder, "source", "job.json"),
      value: { reference: options.reference, photos: [] },
    });
  }
  return assetFolder;
}
function generation(options: {
  item: ReturnType<typeof buildItem>;
  assetId: string;
  source: GenerationRecord["source"];
  stage?: "queued" | "generating";
  createdAt?: string;
}) {
  const createdAt = options.createdAt ?? "2026-11-23T00:00:00.000Z";
  return GenerationRecordSchema.parse({
    job: {
      id:
        options.item.model.kind === "pending"
          ? options.item.model.jobId
          : randomUUID(),
      kind: "generation",
      projectId: project.id,
      itemId: options.item.id,
      stage: options.stage ?? "ready",
      progress: 0,
      createdAt,
      updatedAt: createdAt,
    },
    item: options.item,
    assetId: options.assetId,
    source: options.source,
    prompt: "Build a table",
    held: false,
    attempt: 0,
  });
}
function saveRecords(records: unknown[]) {
  writeJson({ path: join(folder, ".planner", "jobs.json"), value: records });
}
function request(path: string) {
  return fetch(`http://127.0.0.1:${fixture.address.port}${path}`, {
    headers: { origin: TEST_WEB_ORIGIN },
  });
}

test("remove, archive and undo restores the model before the scene is published", async () => {
  writeAsset({ id: "table" });
  const table = buildItem({ id: "table-item", assetId: "table" });
  await command({
    type: "scene.apply",
    command: { type: "item.add", item: table },
  });
  const removal = {
    type: "item.remove",
    itemId: table.id,
  } satisfies Parameters<typeof invertCommand>[0]["command"];
  const undo = invertCommand({
    scene: fixture.daemon.store.loadProject(project.id).scene,
    command: removal,
  });
  expect(undo).toEqual({ type: "item.add", item: table, index: 0 });
  await command({ type: "scene.apply", command: removal });
  await command({ type: "objects.archive", assetId: "table" });
  const hidden = ObjectsArchivedResultSchema.parse(
    await command({ type: "objects.archived" }),
  ).objects;
  expect(hidden).toHaveLength(1);
  expect(hidden.at(0)).toMatchObject({
    assetId: "table",
    itemIds: [],
    builtIn: false,
  });
  const thumbnail = hidden.at(0)?.thumbUrl;
  if (!thumbnail) throw new Error("Missing hidden thumbnail");
  expect(await (await request(thumbnail)).text()).toBe("thumbnail bytes");
  await command({ type: "scene.apply", command: undo });
  expect(existsSync(join(folder, "assets", "table", "model.glb"))).toBe(true);
  expect(existsSync(join(folder, ".planner", "archive", "table"))).toBe(false);
  expect(
    await (
      await request(`/projects/${project.id}/assets/table/model.glb`)
    ).text(),
  ).toBe("model bytes");
  expect(
    ObjectsArchivedResultSchema.parse(
      await command({ type: "objects.archived" }),
    ).objects,
  ).toEqual([]);
  expect(
    ObjectsLibraryResultSchema.parse(
      await command({ type: "objects.library" }),
    ).objects.find((entry) => entry.assetId === "table")?.itemIds,
  ).toEqual([table.id]);
});

test("restore permits a model already referenced by a scene item", async () => {
  const assetFolder = writeAsset({ id: "table" });
  const table = buildItem({ id: "table-item", assetId: "table" });
  await command({
    type: "scene.apply",
    command: { type: "item.add", item: table },
  });
  mkdirSync(join(folder, ".planner", "archive"));
  renameSync(assetFolder, join(folder, ".planner", "archive", "table"));
  expect(await command({ type: "objects.restore", assetId: "table" })).toEqual({
    assetId: "table",
  });
  expect(
    readFileSync(join(folder, "assets", "table", "model.glb"), "utf8"),
  ).toBe("model bytes");
});

test("an unused parent with a child asset cannot be archived", async () => {
  writeAsset({ id: "parent" });
  writeAsset({ id: "child", parentAssetId: "parent" });
  await expect(
    command({ type: "objects.archive", assetId: "parent" }),
  ).rejects.toThrow("depend on this model");
  expect(existsSync(join(folder, "assets", "parent"))).toBe(true);
});

test.each(["queued", "generating"])(
  "%s variants protect their parent before the child asset exists",
  async (stage) => {
    writeAsset({ id: "parent" });
    const pending = buildItem({ id: "pending" });
    const record = generation({
      item: pending,
      assetId: "child",
      source: { kind: "shape", parentAssetId: "parent" },
    });
    record.job = GenerationRecordSchema.shape.job.parse({
      ...record.job,
      stage,
    });
    saveRecords([record]);
    await expect(
      command({ type: "objects.archive", assetId: "parent" }),
    ).rejects.toThrow("depend on this model");
  },
);

test("source receipts follow the current asset across duplicate items and later generation records", async () => {
  writeAsset({ id: "original" });
  const original = buildItem({ id: "original-item", assetId: "original" });
  const duplicate = buildItem({ id: "duplicate-item", assetId: "original" });
  for (const item of [original, duplicate])
    await command({ type: "scene.apply", command: { type: "item.add", item } });
  saveRecords([
    generation({
      item: original,
      assetId: "original",
      source: { kind: "photo", photoId: "correct-photo" },
    }),
    generation({
      item: original,
      assetId: "later",
      source: { kind: "photo", photoId: "wrong-photo" },
      createdAt: "2026-11-23T01:00:00.000Z",
    }),
  ]);
  const items = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources" }),
  ).items;
  expect(items.map((entry) => entry.photos)).toEqual([
    [{ kind: "photo", photoId: "correct-photo", isBest: true }],
    [{ kind: "photo", photoId: "correct-photo", isBest: true }],
  ]);
});

test("malformed assets, references and job records do not hide valid models and sources", async () => {
  writeAsset({
    id: "good",
    reference: { kind: "photo", photoId: "correct-photo" },
  });
  const bad = writeAsset({
    id: "bad-json",
    reference: { kind: "photo", photoId: "other" },
  });
  writeFileSync(join(bad, "meta.json"), "{broken");
  writeAsset({ id: "bad-schema" });
  writeJson({
    path: join(folder, "assets", "bad-schema", "meta.json"),
    value: { id: "bad-schema", kind: "generated" },
  });
  const broken = writeAsset({
    id: "broken-reference",
    reference: { kind: "photo", photoId: "invalid/id" },
  });
  writeFileSync(join(broken, "source", "job.json"), "not JSON");
  writeAsset({
    id: "wrong-protocol",
    reference: {
      kind: "web",
      imageUrl: "https://example.invalid/image.jpg",
      sourceUrl: "javascript:alert(1)",
    },
  });
  for (const id of ["good", "bad-json", "broken-reference", "wrong-protocol"])
    await command({
      type: "scene.apply",
      command: { type: "item.add", item: buildItem({ id, assetId: id }) },
    });
  saveRecords([{ job: { kind: "generation" }, source: { kind: "bad" } }]);
  const library = ObjectsLibraryResultSchema.parse(
    await command({ type: "objects.library" }),
  );
  expect(library.objects.some((entry) => entry.assetId === "good")).toBe(true);
  expect(
    library.objects.some((entry) =>
      ["bad-json", "bad-schema"].includes(entry.assetId),
    ),
  ).toBe(false);
  const sources = ItemSourcesResultSchema.parse(
    await command({ type: "item.sources" }),
  ).items;
  expect(sources.find((entry) => entry.itemId === "good")?.photos).toEqual([
    { kind: "photo", photoId: "correct-photo", isBest: true },
  ]);
  for (const id of ["bad-json", "broken-reference", "wrong-protocol"])
    expect(sources.find((entry) => entry.itemId === id)?.photos).toEqual([]);
  writeFileSync(join(folder, ".planner", "jobs.json"), "{broken");
  expect(
    ObjectsLibraryResultSchema.parse(
      await command({ type: "objects.library" }),
    ).objects.some((entry) => entry.assetId === "good"),
  ).toBe(true);
  expect(
    ItemSourcesResultSchema.parse(
      await command({ type: "item.sources", itemId: "good" }),
    ).items.at(0)?.photos,
  ).toEqual([{ kind: "photo", photoId: "correct-photo", isBest: true }]);
});

test("surface archival reports an object-model error", async () => {
  mkdirSync(join(folder, "assets", "surface"));
  writeJson({
    path: join(folder, "assets", "surface", "meta.json"),
    value: { id: "surface", kind: "surface" },
  });
  await expect(
    command({ type: "objects.archive", assetId: "surface" }),
  ).rejects.toThrow("Only object models can be archived");
});

test.each(["", "   "])(
  "blank item names %j use a nonblank generation name or the default",
  async (name) => {
    writeAsset({ id: "model" });
    const item = { ...buildItem({ id: "item", assetId: "model" }), name };
    await command({ type: "scene.apply", command: { type: "item.add", item } });
    const record = generation({
      item: { ...item, name: "Recorded model" },
      assetId: "model",
      source: { kind: "photo", photoId: "photo" },
    });
    saveRecords([record]);
    expect(
      ObjectsLibraryResultSchema.parse(
        await command({ type: "objects.library" }),
      ).objects.find((entry) => entry.assetId === "model")?.name,
    ).toBe("Recorded model");
    record.item.name = name;
    saveRecords([record]);
    expect(
      ObjectsLibraryResultSchema.parse(
        await command({ type: "objects.library" }),
      ).objects.find((entry) => entry.assetId === "model")?.name,
    ).toBe("Untitled model");
  },
);

test.each(["restore", "undo"])(
  "%s also restores an archived colour parent before publishing its child",
  async (kind) => {
    writeAsset({
      id: "parent",
      reference: { kind: "photo", photoId: "source-photo" },
    });
    const item = buildItem({ id: "child-item", assetId: "child" });
    writeAsset({
      id: "child",
      parentAssetId: "parent",
      reference: {
        kind: "color",
        parentAssetId: "parent",
        color: "#ffffff",
        strength: 1,
        referenceLuma: 0.5,
        nativeSizeM: item.sizeM,
      },
    });
    await command({ type: "scene.apply", command: { type: "item.add", item } });
    const undo = invertCommand({
      scene: fixture.daemon.store.loadProject(project.id).scene,
      command: { type: "item.remove", itemId: item.id },
    });
    await command({
      type: "scene.apply",
      command: { type: "item.remove", itemId: item.id },
    });
    await command({ type: "objects.archive", assetId: "child" });
    await command({ type: "objects.archive", assetId: "parent" });
    if (kind === "restore") {
      await command({ type: "objects.restore", assetId: "child" });
      await command({ type: "scene.apply", command: undo });
    } else {
      await command({ type: "scene.apply", command: undo });
    }
    for (const id of ["parent", "child"])
      expect(existsSync(join(folder, "assets", id, "model.glb"))).toBe(true);
    expect(
      ObjectsArchivedResultSchema.parse(
        await command({ type: "objects.archived" }),
      ).objects,
    ).toEqual([]);
    expect(
      ItemSourcesResultSchema.parse(
        await command({ type: "item.sources", itemId: item.id }),
      ).items.at(0),
    ).toMatchObject({
      origin: "variant",
      photos: [{ kind: "photo", photoId: "source-photo", isBest: true }],
    });
  },
);

test("timezone-offset generation dates sort chronologically and return UTC dates", async () => {
  for (const id of ["one", "two"]) writeAsset({ id });
  const item = buildItem({ id: "item", assetId: "one" });
  saveRecords([
    generation({
      item,
      assetId: "one",
      source: { kind: "photo", photoId: "earlier" },
      createdAt: "2026-11-23T08:00:00+08:00",
    }),
    generation({
      item,
      assetId: "two",
      source: { kind: "photo", photoId: "later" },
      createdAt: "2026-11-23T01:00:00Z",
    }),
  ]);
  const objects = ObjectsLibraryResultSchema.parse(
    await command({ type: "objects.library" }),
  ).objects.filter((entry) => !entry.builtIn);
  expect(objects.map((entry) => [entry.assetId, entry.createdAt])).toEqual([
    ["two", "2026-11-23T01:00:00.000Z"],
    ["one", "2026-11-23T00:00:00.000Z"],
  ]);
});

test("cyclic archived parent metadata is refused without moving either model", async () => {
  writeAsset({ id: "one", parentAssetId: "two" });
  writeAsset({ id: "two", parentAssetId: "one" });
  mkdirSync(join(folder, ".planner", "archive"));
  for (const id of ["one", "two"])
    renameSync(
      join(folder, "assets", id),
      join(folder, ".planner", "archive", id),
    );
  await expect(
    command({ type: "objects.restore", assetId: "one" }),
  ).rejects.toThrow("dependencies contain a cycle");
  for (const id of ["one", "two"]) {
    expect(
      existsSync(join(folder, ".planner", "archive", id, "model.glb")),
    ).toBe(true);
    expect(existsSync(join(folder, "assets", id))).toBe(false);
  }
});
