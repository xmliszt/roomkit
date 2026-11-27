import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { moveLibraryAsset } from "../objects/move-library-asset.ts";

export function restoreArchivedAssets(options: {
  folder: string;
  project: Project;
}) {
  for (const item of options.project.scene.items) {
    if (item.model.kind !== "asset") continue;
    const assetId = item.model.assetId;
    if (
      existsSync(join(options.folder, "assets", assetId)) ||
      !existsSync(join(options.folder, ".planner", "archive", assetId))
    )
      continue;
    moveLibraryAsset({ ...options, assetId, kind: "restore" });
  }
}
