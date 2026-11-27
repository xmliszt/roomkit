import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { ObjectsArchiveResultSchema } from "@planner/shared/src/protocol/objects-archive-result-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { hasAssetDependents } from "./has-asset-dependents.ts";
import { readObjectJson } from "./read-object-json.ts";

export function moveLibraryAsset(options: {
  folder: string;
  project: Project;
  assetId: string;
  kind: "archive" | "restore";
  parentAssetIds?: string[];
}) {
  IdSchema.parse(options.assetId);
  if (CHARGING_PORT_TYPES.some((entry) => entry.assetId === options.assetId))
    throw new Error("Built-in catalog models cannot be archived or restored");
  if (
    options.kind === "archive" &&
    options.project.scene.items.some(
      (item) =>
        item.model.kind === "asset" && item.model.assetId === options.assetId,
    )
  )
    throw new Error("The model is used by an item in the room");
  const source =
    options.kind === "archive"
      ? join("assets", options.assetId)
      : join(".planner", "archive", options.assetId);
  const destination =
    options.kind === "archive"
      ? join(".planner", "archive", options.assetId)
      : join("assets", options.assetId);
  if (!existsSync(join(options.folder, source)))
    throw new Error("Unknown object model");
  const sourcePath = jobFilePath({ folder: options.folder, path: source });
  const meta = AssetMetaSchema.safeParse(
    readObjectJson({ folder: options.folder, path: join(source, "meta.json") }),
  );
  if (!meta.success) throw new Error("Only object models can be archived");
  if (meta.data.id !== options.assetId)
    throw new Error("Object model id does not match its folder");
  const parentAssetId = meta.data.parentAssetId;
  if (
    options.kind === "restore" &&
    parentAssetId &&
    !existsSync(join(options.folder, "assets", parentAssetId)) &&
    existsSync(join(options.folder, ".planner", "archive", parentAssetId))
  ) {
    const parentAssetIds = [...(options.parentAssetIds ?? []), options.assetId];
    if (parentAssetIds.includes(parentAssetId))
      throw new Error("Model dependencies contain a cycle");
    moveLibraryAsset({ ...options, assetId: parentAssetId, parentAssetIds });
  }
  if (options.kind === "archive") {
    if (
      hasAssetDependents({
        folder: options.folder,
        projectId: options.project.id,
        assetId: options.assetId,
      })
    )
      throw new Error("Other models or active jobs depend on this model");
    const plannerPath = jobFilePath({
      folder: options.folder,
      path: ".planner",
    });
    const archivePath = join(plannerPath, "archive");
    if (!existsSync(archivePath))
      mkdirSync(
        jobFilePath({ folder: options.folder, path: ".planner/archive" }),
      );
  }
  const destinationPath = jobFilePath({
    folder: options.folder,
    path: destination,
  });
  if (existsSync(destinationPath))
    throw new Error("The destination model already exists");
  renameSync(sourcePath, destinationPath);
  return ObjectsArchiveResultSchema.parse({ assetId: options.assetId });
}
