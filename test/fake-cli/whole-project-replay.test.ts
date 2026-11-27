import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, it } from "vitest";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import { prepareReplay } from "../../scripts/demo/prepare-replay.ts";
import { seedReplayProject } from "../../scripts/demo/seed-replay-project.ts";

it("keeps late sources and duplicate order, omits missing models and holds jobs until added", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-whole-replay-"));
  try {
    const source = join(root, "source");
    const replayRoot = join(root, "replay");
    for (const name of [".planner", "photos", "recon"])
      mkdirSync(join(source, name), { recursive: true });
    mkdirSync(replayRoot);
    const scene = createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 3,
    });
    const sizeM = { width: 1, height: 1, depth: 1 };
    function item(options: { id: string; assetId: string }) {
      return {
        id: options.id,
        name: options.id,
        model: { kind: "asset", assetId: options.assetId },
        sizeM,
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        locked: false,
      };
    }
    const original = item({ id: "photo-item", assetId: "photo-asset" });
    const projectId = "00000000-0000-4000-8000-000000000001";
    const reconstructionJobId = "00000000-0000-4000-8000-000000000002";
    const time = "2026-11-23T00:00:00.000Z";
    const generation = {
      job: {
        id: "generation",
        kind: "generation-alternative",
        method: "sam3d",
        projectId,
        itemId: original.id,
        stage: "ready",
        progress: 1,
        createdAt: time,
        updatedAt: time,
      },
      item: original,
      source: { kind: "photo", photoId: "own-photo" },
      prompt: "Use this photo",
      held: false,
      attempt: 0,
      assetId: "photo-asset",
    };
    writeJson({
      path: join(source, "project.json"),
      value: {
        id: projectId,
        name: "Replay",
        revision: 0,
        reconstruction: { jobId: reconstructionJobId, weakScale: false },
        scene: {
          ...scene,
          items: [
            original,
            item({ id: "duplicate", assetId: "photo-asset" }),
            {
              ...item({ id: "catalog", assetId: "catalog" }),
              light: {
                on: true,
                emitter: { x: 0.4, y: 0.9, z: 0.5 },
                shade: "opaque",
                lumens: 800,
                temperatureK: 2700,
              },
            },
            item({ id: "missing", assetId: "missing" }),
          ],
        },
      },
    });
    writeJson({
      path: join(source, ".planner", "jobs.json"),
      value: [
        generation,
        {
          job: {
            id: "00000000-0000-4000-8000-000000000003",
            kind: "bulb",
            projectId,
            itemId: original.id,
            stage: "done",
            progress: 1,
            lastLogLine: "placed the bulb",
            createdAt: time,
            updatedAt: time,
          },
          assetId: "photo-asset",
          outcome: {
            kind: "placed",
            emitter: { x: 0.5, y: 0.62, z: 0.5 },
            beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
            shade: "translucent",
            lumens: 200,
          },
        },
        {
          job: {
            id: "00000000-0000-4000-8000-000000000004",
            kind: "bulb",
            projectId,
            itemId: original.id,
            stage: "done",
            progress: 1,
            lastLogLine: "skipped: the item changed",
            createdAt: time,
            updatedAt: time,
          },
          assetId: "photo-asset",
          outcome: {
            kind: "placed",
            emitter: { x: 0.1, y: 0.1, z: 0.1 },
            shade: "opaque",
          },
        },
        {
          job: {
            id: "inventory",
            kind: "inventory",
            projectId,
            reconstructionJobId,
            stage: "done",
            progress: 1,
            createdAt: time,
            updatedAt: time,
          },
          room: scene.room,
          photoIds: [],
          scenePath: "scene.npz",
          camerasPath: "cameras.json",
          submission: [],
          outcome: {
            items: [],
            generationJobs: [],
            objectIds: [],
            undo: [],
            blocks: [],
          },
        },
      ],
    });
    for (const assetId of ["photo-asset", "catalog"]) {
      const folder = join(source, "assets", assetId);
      mkdirSync(folder, { recursive: true });
      writeJson({ path: join(folder, "model.glb"), value: "saved bytes" });
      writeJson({
        path: join(folder, "meta.json"),
        value: {
          id: assetId,
          kind: assetId === "catalog" ? "catalog" : "generated",
          nativeSizeM: sizeM,
          mount: "floor",
          triangleCount: 12,
          hasColorMask: false,
          provenance: { method: "saved", sourcePhotoIds: [] },
        },
      });
    }
    mkdirSync(join(source, "renders"));
    writeFileSync(join(source, "renders", "new.png"), "new");
    writeFileSync(join(source, "renders", "old.png"), "old");
    utimesSync(join(source, "renders", "new.png"), 200, 200);
    utimesSync(join(source, "renders", "old.png"), 100, 100);
    const saved = prepareReplay({ source, root: replayRoot });
    expect(saved.renders).toEqual(["new.png", "old.png"]);
    expect(
      readFileSync(join(saved.snapshot, "renders", "new.png"), "utf8"),
    ).toBe("new");
    expect(saved.entries.map((entry) => entry.item.id)).toEqual([
      "photo-item",
      "duplicate",
      "catalog",
    ]);
    expect(saved.entries.map((entry) => entry.bulb)).toEqual([
      {
        x: 0.5,
        y: 0.62,
        z: 0.5,
        beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
        shade: "translucent",
        lumens: 200,
      },
      {
        x: 0.5,
        y: 0.62,
        z: 0.5,
        beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
        shade: "translucent",
        lumens: 200,
      },
      { x: 0.4, y: 0.9, z: 0.5, beam: null, shade: "opaque", lumens: 800 },
    ]);
    expect(saved.inventory.submission).toEqual([]);
    expect(saved.omitted).toEqual([
      { itemId: "missing", name: "missing", reason: "No saved model" },
    ]);
    const project = seedReplayProject({
      saved,
      root: replayRoot,
      name: "Replay",
    });
    expect(project.scene.items).toEqual([]);
    const records = JSON.parse(
      readFileSync(
        join(replayRoot, "projects", project.id, ".planner", "jobs.json"),
        "utf8",
      ),
    );
    expect(records.map((record: typeof generation) => record.source)).toEqual([
      generation.source,
      generation.source,
    ]);
    expect(
      records.map(
        (record: {
          job: { stage: string };
          held: boolean;
          regeneration?: unknown;
        }) => [record.job.stage, record.held, record.regeneration],
      ),
    ).toEqual([
      ["held", true, undefined],
      ["held", true, undefined],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
