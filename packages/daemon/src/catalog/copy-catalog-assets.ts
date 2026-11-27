import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { catalogAssetsMatch } from "./catalog-assets-match.ts";

export function copyCatalogAssets(options: {
  catalogRoot: string;
  catalogAssetIds: ReadonlySet<string>;
  projectFolder: string;
  scene: Scene;
  refresh?: boolean;
}) {
  const assetsFolder = join(options.projectFolder, "assets");
  for (const item of options.scene.items) {
    if (item.model.kind !== "asset") continue;
    const assetId = item.model.assetId;
    if (!options.catalogAssetIds.has(assetId)) continue;
    const target = join(assetsFolder, assetId);
    const source = join(options.catalogRoot, assetId);
    if (
      existsSync(target) &&
      (!options.refresh || catalogAssetsMatch({ source, target }))
    )
      continue;
    const temporary = join(assetsFolder, `.${assetId}.${randomUUID()}.tmp`);
    mkdirSync(assetsFolder, { recursive: true });
    try {
      cpSync(source, temporary, {
        recursive: true,
      });
      const previous = `${temporary}.previous`;
      const hadTarget = existsSync(target);
      if (hadTarget) renameSync(target, previous);
      try {
        renameSync(temporary, target);
      } catch (error) {
        if (hadTarget) renameSync(previous, target);
        throw error;
      }
      rmSync(previous, { recursive: true, force: true });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
