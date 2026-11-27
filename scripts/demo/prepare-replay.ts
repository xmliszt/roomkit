import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { BulbRecordSchema } from "../../packages/daemon/src/bulb/bulb-record-schema.ts";
import { GenerationRecordSchema } from "../../packages/daemon/src/generation/generation-record-schema.ts";
import { InventoryRecordSchema } from "../../packages/daemon/src/inventory/inventory-record-schema.ts";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";

import { fitReplayAsset } from "./fit-replay-asset.ts";

export function prepareReplay(options: { source: string; root: string }) {
  const source = realpathSync(options.source);
  const project = ProjectSchema.parse(
    JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
  );
  const records: unknown[] = JSON.parse(
    readFileSync(join(source, ".planner", "jobs.json"), "utf8"),
  );
  const inventory = records
    .map((record) => InventoryRecordSchema.safeParse(record))
    .filter((result) => result.success)
    .map((result) => result.data)
    .findLast((record) =>
      project.inventory
        ? record.job.id === project.inventory.jobId
        : record.job.stage === "done" &&
          record.job.reconstructionJobId === project.reconstruction?.jobId,
    );
  assert.ok(
    inventory?.outcome && inventory.submission,
    "Source needs a saved inventory",
  );
  const inventoryFolder = join(
    source,
    ".planner",
    "inventory",
    inventory.job.id,
  );
  const objectIds: string[] =
    inventory.outcome.objectIds ??
    (inventory.outcome.items.length === 0
      ? []
      : JSON.parse(
          readFileSync(join(inventoryFolder, "measurement.json"), "utf8"),
        ).objects.map((object: { objectId: string }) => object.objectId));
  const generations = records
    .map((record) => GenerationRecordSchema.safeParse(record))
    .filter((result) => result.success)
    .map((result) => result.data);
  const bulbs = records
    .map((record) => BulbRecordSchema.safeParse(record))
    .filter((result) => result.success)
    .map((result) => result.data);
  const omitted = project.scene.items.flatMap((item) =>
    item.model.kind !== "asset" ||
    !existsSync(join(source, "assets", item.model.assetId, "model.glb"))
      ? [{ itemId: item.id, name: item.name, reason: "No saved model" }]
      : [],
  );
  const inventoryItems = inventory.outcome.items;
  const entries = project.scene.items
    .filter((item) => !omitted.some((entry) => entry.itemId === item.id))
    .map((item) => {
      assert.ok(item.model.kind === "asset");
      const index = inventoryItems.findIndex(
        (original) => original.id === item.id,
      );
      const assetId = item.model.assetId;
      const generation = generations.findLast(
        (record) => record.assetId === assetId,
      );
      const meta = AssetMetaSchema.parse(
        JSON.parse(
          readFileSync(
            join(source, "assets", item.model.assetId, "meta.json"),
            "utf8",
          ),
        ),
      );
      assert.ok(
        index >= 0 || generation || meta.kind === "catalog",
        `No saved generation source for ${item.name}`,
      );
      const placed = bulbs
        .flatMap((record) =>
          record.assetId === assetId &&
          record.job.lastLogLine === "placed the bulb" &&
          record.outcome?.kind === "placed"
            ? [record.outcome]
            : [],
        )
        .at(-1);
      const sourceObjectId = index >= 0 ? objectIds.at(index) : undefined;
      if (index >= 0)
        assert.ok(sourceObjectId, `No inventory mapping for ${item.name}`);
      return {
        objectId: item.id,
        sourceObjectId,
        replayJobId: randomUUID(),
        generation,
        bulb: item.light
          ? {
              ...item.light.emitter,
              beam: item.light.beam ?? null,
              shade: item.light.shade,
              lumens: item.light.lumens,
            }
          : placed && {
              ...placed.emitter,
              beam: placed.beam,
              shade: placed.shade,
              lumens: placed.lumens,
            },
        catalog: meta.kind === "catalog",
        item,
      };
    });
  const snapshot = join(options.root, "source");
  mkdirSync(snapshot);
  const rendersFolder = join(source, "renders");
  const renders = existsSync(rendersFolder)
    ? readdirSync(rendersFolder)
        .filter(
          (name) =>
            name.endsWith(".png") &&
            statSync(join(rendersFolder, name)).isFile(),
        )
        .toSorted(
          (a, b) =>
            statSync(join(rendersFolder, b)).mtimeMs -
            statSync(join(rendersFolder, a)).mtimeMs,
        )
    : [];
  for (const name of renders)
    cpSync(join(rendersFolder, name), join(snapshot, "renders", name));
  for (const name of ["photos", "recon"])
    cpSync(join(source, name), join(snapshot, name), {
      recursive: true,
      dereference: true,
    });
  if (existsSync(join(source, ".planner", "chat.json")))
    cpSync(join(source, ".planner", "chat.json"), join(snapshot, "chat.json"));
  if (existsSync(inventoryFolder))
    cpSync(inventoryFolder, join(snapshot, "inventory"), {
      recursive: true,
      dereference: true,
    });
  for (const entry of entries) {
    if (entry.item.model.kind !== "asset") continue;
    cpSync(
      join(source, "assets", entry.item.model.assetId),
      join(snapshot, "assets", entry.item.model.assetId),
      { recursive: true, dereference: true },
    );
  }
  const fittedAssets = new Set<string>();
  for (const entry of entries) {
    if (entry.item.model.kind !== "asset") continue;
    const originalAssetId = entry.item.model.assetId;
    const assetId = fittedAssets.has(originalAssetId)
      ? randomUUID()
      : originalAssetId;
    fittedAssets.add(originalAssetId);
    const folder = join(snapshot, "assets", assetId);
    if (assetId !== originalAssetId) {
      cpSync(join(source, "assets", originalAssetId), folder, {
        recursive: true,
        dereference: true,
      });
      const meta = AssetMetaSchema.parse(
        JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")),
      );
      writeJson({
        path: join(folder, "meta.json"),
        value: { ...meta, id: assetId },
      });
      entry.item = { ...entry.item, model: { kind: "asset", assetId } };
    }
    fitReplayAsset({ folder, sizeM: entry.item.sizeM });
  }
  for (const surface of Object.values(project.scene.room.surfaces)) {
    const material = surface.material;
    if (material && "textureAssetId" in material && material.textureAssetId)
      cpSync(
        join(source, "assets", material.textureAssetId),
        join(snapshot, "assets", material.textureAssetId),
        { recursive: true, dereference: true },
      );
  }
  const submission = entries
    .filter((entry) => entry.sourceObjectId)
    .map((entry) => {
      const original = inventory.submission?.find(
        (object) => object.objectId === entry.sourceObjectId,
      );
      assert.ok(original);
      return {
        ...original,
        objectId: entry.objectId,
        views: original.views.map((view) => ({
          ...view,
          visibility:
            entry.item.model.kind === "pending"
              ? "more-than-half-hidden"
              : view.visibility,
        })),
      };
    });
  const data = {
    renders,
    project,
    inventory: { ...inventory, submission },
    entries,
    omitted,
  };
  writeJson({ path: join(snapshot, "replay.json"), value: data });
  return { ...data, snapshot };
}
