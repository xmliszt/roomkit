import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import validator from "gltf-validator";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { EventBus } from "../ws/event-bus.ts";
import { createProjectStore } from "./create-project-store.ts";

const room = { widthM: 4, depthM: 5, ceilingHeightM: 2.6 };

const createdRoots: string[] = [];

function buildStore(
  options: { projectsRoot?: string; writeJson?: typeof writeJson } = {},
) {
  mkdirSync(".tmp", { recursive: true });
  const projectsRoot =
    options.projectsRoot ?? mkdtempSync(resolve(".tmp/project-store-"));
  if (options.projectsRoot === undefined) createdRoots.push(projectsRoot);
  const catalogRoot = mkdtempSync(resolve(".tmp/catalog-"));
  createdRoots.push(catalogRoot);
  for (const assetId of ["plug", "socket"]) {
    mkdirSync(join(catalogRoot, assetId));
    writeFileSync(join(catalogRoot, assetId, "meta.json"), "{}");
  }
  const bus = new EventBus();
  const events: PlannerEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const store = createProjectStore({
    projectsRoot,
    catalogRoot,
    catalogAssetIds: new Set(["plug", "socket", "lost"]),
    bus,
    logger: createLogger("test"),
    writeDelayMs: 500,
    ...(options.writeJson === undefined
      ? {}
      : { writeJson: options.writeJson }),
  });
  return { projectsRoot, store, events };
}

function readRevision(options: { projectsRoot: string; projectId: string }) {
  return JSON.parse(
    readFileSync(
      join(options.projectsRoot, options.projectId, "project.json"),
      "utf8",
    ),
  ).revision;
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of createdRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("creates the project folder layout and lists and loads the project", () => {
  const { projectsRoot, store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  expect(project.revision).toBe(0);
  expect(project.scene.room.walls).toHaveLength(4);
  for (const folder of ["photos", "recon", "assets", "snapshots", ".planner"])
    expect(() =>
      readFileSync(join(projectsRoot, project.id, folder)),
    ).toThrowError(/EISDIR/);
  expect(events).toStrictEqual([
    {
      kind: "project.created",
      project: { id: project.id, name: "Living room" },
    },
  ]);
  const reopened = buildStore({ projectsRoot }).store;
  expect(reopened.listProjects()).toStrictEqual([
    { id: project.id, name: "Living room" },
  ]);
  expect(reopened.loadProject(project.id)).toStrictEqual(project);
});

test("applies a command, publishes it with the next revision, and writes after the delay", () => {
  vi.useFakeTimers();
  const { projectsRoot, store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  const command = {
    type: "surface.update",
    surfaceId: "floor",
    color: "#c8b79a",
  } satisfies Command;
  expect(
    store.applyCommand({
      projectId: project.id,
      command,
      requestId: "11111111-1111-4111-8111-111111111111",
    }),
  ).toStrictEqual({ revision: 1 });
  expect(
    store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 2.8 },
      requestId: undefined,
    }),
  ).toStrictEqual({ revision: 2 });
  expect(events.slice(1)).toStrictEqual([
    {
      kind: "scene.changed",
      projectId: project.id,
      command,
      revision: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
    },
    {
      kind: "scene.changed",
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 2.8 },
      revision: 2,
    },
  ]);
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(0);
  vi.advanceTimersByTime(499);
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(0);
  vi.advanceTimersByTime(1);
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(2);
});

test("flush writes a pending change at once", () => {
  vi.useFakeTimers();
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: { type: "room.update", ceilingHeightM: 2.8 },
    requestId: undefined,
  });
  store.flush();
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(1);
  expect(
    buildStore({ projectsRoot }).store.loadProject(project.id).scene.room
      .ceilingHeightM,
  ).toBe(2.8);
});

test("a rejected command changes nothing and publishes nothing", () => {
  const { store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  expect(() =>
    store.applyCommand({
      projectId: project.id,
      command: { type: "item.remove", itemId: "ghost" },
      requestId: undefined,
    }),
  ).toThrowError("Item ghost does not exist");
  expect(store.loadProject(project.id)).toStrictEqual(project);
  expect(events).toHaveLength(1);
});

test("refuses a project id that is not a UUID or that has no project", () => {
  const { store } = buildStore();
  expect(() => store.loadProject("../outside")).toThrowError();
  expect(() =>
    store.loadProject("00000000-0000-4000-8000-000000000000"),
  ).toThrowError("does not exist");
});

test("lists only folders that hold a valid project.json", () => {
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  const brokenId = "00000000-0000-4000-8000-000000000001";
  mkdirSync(join(projectsRoot, brokenId));
  writeFileSync(join(projectsRoot, brokenId, "project.json"), "{}");
  mkdirSync(join(projectsRoot, "notes"));
  expect(store.listProjects()).toStrictEqual([
    { id: project.id, name: "Living room" },
  ]);
});

test("skips a folder whose project.json holds another project's id", () => {
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  const copyId = "00000000-0000-4000-8000-000000000002";
  cpSync(join(projectsRoot, project.id), join(projectsRoot, copyId), {
    recursive: true,
  });
  const reopened = buildStore({ projectsRoot }).store;
  expect(reopened.listProjects()).toStrictEqual([
    { id: project.id, name: "Living room" },
  ]);
  expect(() => reopened.loadProject(copyId)).toThrowError(
    `project.json holds the id ${project.id}`,
  );
});

test("a failed write keeps the change for the next flush and does not stop other projects", () => {
  vi.useFakeTimers();
  const { projectsRoot, store } = buildStore();
  const lost = store.createProject({ name: "Lost", room });
  const kept = store.createProject({ name: "Kept", room });
  for (const project of [lost, kept])
    store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 2.8 },
      requestId: undefined,
    });
  rmSync(join(projectsRoot, lost.id), { recursive: true });
  vi.advanceTimersByTime(500);
  expect(readRevision({ projectsRoot, projectId: kept.id })).toBe(1);
  store.applyCommand({
    projectId: kept.id,
    command: { type: "room.update", ceilingHeightM: 3 },
    requestId: undefined,
  });
  expect(() => store.flush()).toThrowError(
    `Could not write project ${lost.id}`,
  );
  expect(() => store.flush()).toThrowError(
    `Could not write project ${lost.id}`,
  );
  expect(readRevision({ projectsRoot, projectId: kept.id })).toBe(2);
  mkdirSync(join(projectsRoot, lost.id));
  store.flush();
  expect(readRevision({ projectsRoot, projectId: lost.id })).toBe(1);
});

function wallItem(options: { id: string; assetId: string }) {
  return {
    ...buildItem({
      id: options.id,
      placement: {
        kind: "wall",
        wallId: "wall-2",
        alongM: 1.2,
        heightM: 0.3,
        rotationRad: 0,
      },
    }),
    model: { kind: "asset", assetId: options.assetId },
  } satisfies Item;
}

test("a failed first write leaves no project loaded, listed or on disk", () => {
  const { projectsRoot, store, events } = buildStore({
    writeJson() {
      throw new Error("disk full");
    },
  });
  expect(() => store.createProject({ name: "Living room", room })).toThrow(
    "disk full",
  );
  expect(readdirSync(projectsRoot)).toStrictEqual([]);
  expect(store.listProjects()).toStrictEqual([]);
  expect(events).toStrictEqual([]);
  expect(() => store.flush()).not.toThrow();
});

test("rename writes at once, keeps the revision and publishes project.renamed", () => {
  const { projectsRoot, store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  expect(
    store.renameProject({ projectId: project.id, name: "Den" }),
  ).toStrictEqual({
    id: project.id,
    name: "Den",
  });
  expect(events.at(-1)).toStrictEqual({
    kind: "project.renamed",
    project: { id: project.id, name: "Den" },
  });
  expect(
    buildStore({ projectsRoot }).store.loadProject(project.id),
  ).toStrictEqual({
    ...project,
    name: "Den",
  });
});

test("a rename whose write fails keeps the old name and publishes nothing", () => {
  let isBroken = false;
  const { store, events } = buildStore({
    writeJson(options) {
      if (isBroken) throw new Error("disk full");
      writeJson(options);
    },
  });
  const project = store.createProject({ name: "Living room", room });
  isBroken = true;
  expect(() =>
    store.renameProject({ projectId: project.id, name: "Den" }),
  ).toThrow("disk full");
  expect(store.loadProject(project.id).name).toBe("Living room");
  expect(events).toHaveLength(1);
});

test("remove moves the folder to .trash, forgets the project and publishes project.removed", () => {
  vi.useFakeTimers();
  const { projectsRoot, store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: { type: "room.update", ceilingHeightM: 2.8 },
    requestId: undefined,
  });
  expect(store.removeProject(project.id)).toStrictEqual({
    projectId: project.id,
  });
  expect(events.at(-1)).toStrictEqual({
    kind: "project.removed",
    projectId: project.id,
  });
  expect(existsSync(join(projectsRoot, project.id))).toBe(false);
  const [trashed] = readdirSync(join(projectsRoot, ".trash"));
  expect(trashed).toMatch(new RegExp(`^${project.id}-\\d+$`));
  expect(
    JSON.parse(
      readFileSync(
        join(projectsRoot, ".trash", trashed ?? "", "project.json"),
        "utf8",
      ),
    ).revision,
  ).toBe(1);
  expect(store.listProjects()).toStrictEqual([]);
  expect(() => store.loadProject(project.id)).toThrow("does not exist");
  expect(() =>
    store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 3 },
      requestId: undefined,
    }),
  ).toThrow("does not exist");
  vi.advanceTimersByTime(1000);
  expect(existsSync(join(projectsRoot, project.id))).toBe(false);
  expect(() => store.flush()).not.toThrow();
});

test("an item using a catalog asset copies the asset into the project once", () => {
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.add",
      item: wallItem({ id: "port", assetId: "plug" }),
    },
    requestId: undefined,
  });
  const metaPath = join(
    projectsRoot,
    project.id,
    "assets",
    "plug",
    "meta.json",
  );
  expect(readFileSync(metaPath, "utf8")).toBe("{}");
  writeFileSync(metaPath, "kept");
  store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.add",
      item: wallItem({ id: "port-2", assetId: "plug" }),
    },
    requestId: undefined,
  });
  expect(readFileSync(metaPath, "utf8")).toBe("kept");
  expect(readdirSync(join(projectsRoot, project.id, "assets"))).toStrictEqual([
    "plug",
  ]);
});

test("switching an item to another catalog asset copies that asset and keeps the first", () => {
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.add",
      item: wallItem({ id: "port", assetId: "plug" }),
    },
    requestId: undefined,
  });
  store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: "port",
      patch: {
        model: { kind: "asset", assetId: "socket" },
        sizeM: { width: 0.08, height: 0.08, depth: 0.011 },
      },
    },
    requestId: undefined,
  });
  expect(
    readdirSync(join(projectsRoot, project.id, "assets")).toSorted(),
  ).toStrictEqual(["plug", "socket"]);
});

test("an import copies each catalog asset its scene uses that the archive lacks", () => {
  const { projectsRoot, store } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.add",
      item: wallItem({ id: "port", assetId: "socket" }),
    },
    requestId: undefined,
  });
  store.flush();
  const unpacked = join(projectsRoot, ".import-test");
  cpSync(join(projectsRoot, project.id), unpacked, { recursive: true });
  rmSync(join(unpacked, "assets"), { recursive: true });
  const copy = store.importProject(unpacked);
  expect(
    readFileSync(
      join(projectsRoot, copy.id, "assets", "socket", "meta.json"),
      "utf8",
    ),
  ).toBe("{}");
});

test("a command whose catalog copy fails is rejected and changes nothing", () => {
  const { store, events } = buildStore();
  const project = store.createProject({ name: "Living room", room });
  expect(() =>
    store.applyCommand({
      projectId: project.id,
      command: {
        type: "item.add",
        item: wallItem({ id: "port", assetId: "lost" }),
      },
      requestId: undefined,
    }),
  ).toThrow();
  expect(store.loadProject(project.id)).toStrictEqual(project);
  expect(events).toHaveLength(1);
});

test("a remove whose write fails keeps the project in place and loaded", () => {
  vi.useFakeTimers();
  let isBroken = false;
  const { projectsRoot, store, events } = buildStore({
    writeJson(options) {
      if (isBroken) throw new Error("disk full");
      writeJson(options);
    },
  });
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: { type: "room.update", ceilingHeightM: 2.8 },
    requestId: undefined,
  });
  isBroken = true;
  expect(() => store.removeProject(project.id)).toThrow("disk full");
  expect(existsSync(join(projectsRoot, project.id))).toBe(true);
  expect(store.loadProject(project.id).revision).toBe(1);
  expect(events.at(-1)?.kind).toBe("scene.changed");
  isBroken = false;
  vi.advanceTimersByTime(500);
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(1);
});

test("a failed reconstruction save restores the pending autosave", () => {
  vi.useFakeTimers();
  let isBroken = false;
  const { projectsRoot, store, events } = buildStore({
    writeJson(options) {
      if (isBroken) throw new Error("disk full");
      writeJson(options);
    },
  });
  const project = store.createProject({ name: "Living room", room });
  store.applyCommand({
    projectId: project.id,
    command: { type: "room.update", ceilingHeightM: 2.9 },
    requestId: undefined,
  });
  isBroken = true;
  expect(() =>
    store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 3.1 },
      requestId: undefined,
      reconstruction: { jobId: crypto.randomUUID(), weakScale: true },
    }),
  ).toThrow("disk full");
  expect(events.filter((event) => event.kind === "scene.changed")).toHaveLength(
    1,
  );
  isBroken = false;
  vi.advanceTimersByTime(500);
  expect(readRevision({ projectsRoot, projectId: project.id })).toBe(1);
  const reopened = buildStore({ projectsRoot }).store.loadProject(project.id);
  expect(reopened.scene.room.ceilingHeightM).toBe(2.9);
  expect(reopened.reconstruction).toBeUndefined();
});

test.each([
  { action: "opening", reset: false },
  { action: "resetting", reset: true },
])(
  "$action the sample copies all five furniture bundles at native size",
  async ({ reset }) => {
    const { store } = buildStore();
    const sample = store.openSampleProject(undefined);
    const project = reset ? store.openSampleProject(sample.id) : sample;
    const vector = z.tuple([z.number(), z.number(), z.number()]);
    const gltfSchema = z.object({
      accessors: z.array(
        z.object({
          count: z.number(),
          min: vector.optional(),
          max: vector.optional(),
        }),
      ),
      buffers: z.array(z.object({ uri: z.never().optional() })).length(1),
      images: z
        .array(z.object({ bufferView: z.number(), uri: z.never().optional() }))
        .min(1),
      meshes: z.array(
        z.object({
          primitives: z.array(
            z.object({
              attributes: z.object({ POSITION: z.number() }),
              indices: z.number(),
            }),
          ),
        }),
      ),
      nodes: z
        .array(
          z.object({
            matrix: z.never().optional(),
            rotation: z.never().optional(),
            scale: z.never().optional(),
            translation: z.never().optional(),
          }),
        )
        .min(1),
    });

    if (reset) expect(project.id).not.toBe(sample.id);
    expect(project.scene.items.map((item) => item.id).toSorted()).toEqual([
      "chair",
      "lamp",
      "rug",
      "sofa",
      "table",
    ]);
    expect(
      project.scene.items.find((item) => item.id === "lamp")?.light,
    ).toMatchObject({
      on: false,
      shade: "translucent",
      emitter: { x: 0.5, y: 0.9, z: 0.5 },
    });
    for (const item of project.scene.items) {
      const assetId = `sample-${item.id}`;
      expect(item.model).toEqual({ kind: "asset", assetId });
      const folder = join(store.projectPath(project.id), "assets", assetId);
      const meta = AssetMetaSchema.parse(
        JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")),
      );
      expect(meta).toMatchObject({ id: assetId, nativeSizeM: item.sizeM });
      const thumb = readFileSync(join(folder, "thumb.png"));
      expect(thumb.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
      const model = readFileSync(join(folder, "model.glb"));
      expect(model.toString("ascii", 0, 4)).toBe("glTF");
      const report = await validator.validateBytes(model);
      expect(report.issues.numErrors).toBe(0);
      const gltf = gltfSchema.parse(
        JSON.parse(model.toString("utf8", 20, 20 + model.readUInt32LE(12))),
      );
      const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives);
      const positions = primitives.map((primitive) =>
        gltf.accessors.at(primitive.attributes.POSITION),
      );
      for (const [axis, expectedM] of [
        item.sizeM.width,
        item.sizeM.height,
        item.sizeM.depth,
      ].entries()) {
        const low = Math.min(
          ...positions.map((position) => position?.min?.[axis] ?? Number.NaN),
        );
        const high = Math.max(
          ...positions.map((position) => position?.max?.[axis] ?? Number.NaN),
        );
        expect(high - low).toBeCloseTo(expectedM, 5);
      }
      const triangles = primitives.reduce(
        (count, primitive) =>
          count +
          (gltf.accessors.at(primitive.indices)?.count ?? Number.NaN) / 3,
        0,
      );
      expect(triangles).toBe(meta.triangleCount);
    }
  },
);

test("a failed sample reset keeps the current sample available", () => {
  const write = vi.fn(writeJson);
  const { store, events } = buildStore({ writeJson: write });
  const original = store.openSampleProject(undefined);
  write.mockImplementationOnce(() => {
    throw new Error("Sample could not be written");
  });

  expect(() => store.openSampleProject(original.id)).toThrow(
    "Sample could not be written",
  );
  expect(store.openSampleProject(undefined).id).toBe(original.id);
  expect(events.map((event) => event.kind)).toEqual(["project.created"]);
});
