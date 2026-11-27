import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import { RenderViewSchema } from "@planner/shared/src/render/render-view-schema.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { writeJson } from "../util/write-json.ts";

export function exportRenderScene(options: {
  project: Project;
  view: RenderView;
  projectFolder: string;
  folder: string;
}) {
  const view = RenderViewSchema.parse(options.view);
  const scene = structuredClone(options.project.scene);
  const surfaceIds = new Set([
    "ceiling",
    ...scene.room.walls.map((wall) => wall.id),
  ]);
  if (view.hiddenSurfaceIds.some((id) => !surfaceIds.has(id)))
    throw new Error("The render view names a surface outside this room");
  const visibleItems = scene.items.filter(
    (item) =>
      item.model.kind === "asset" &&
      !(
        item.placement.kind === "wall" &&
        view.hiddenSurfaceIds.includes(item.placement.wallId)
      ),
  );
  mkdirSync(options.folder, { recursive: true });
  function copy(optionsCopy: {
    assetId: string;
    fileName: string;
    optional?: boolean;
  }) {
    const relative = join("assets", optionsCopy.assetId, optionsCopy.fileName);
    const source = jobFilePath({
      folder: options.projectFolder,
      path: relative,
    });
    if (optionsCopy.optional && !existsSync(source)) return undefined;
    mkdirSync(join(options.folder, "assets", optionsCopy.assetId), {
      recursive: true,
    });
    copyFileSync(source, join(options.folder, relative));
    return relative;
  }
  const assets = [
    ...new Set(
      visibleItems.flatMap((item) =>
        item.model.kind === "asset" ? [item.model.assetId] : [],
      ),
    ),
  ].map((assetId) => ({
    assetId,
    modelPath: copy({ assetId, fileName: "model.glb" }),
    metaPath: copy({ assetId, fileName: "meta.json" }),
    colorMaskPath: copy({ assetId, fileName: "colorMask.png", optional: true }),
  }));
  const surfaces = [
    ...new Set(
      Object.values(scene.room.surfaces).flatMap((surface) =>
        surface.material &&
        surface.material.kind !== "paint" &&
        surface.material.textureAssetId
          ? [surface.material.textureAssetId]
          : [],
      ),
    ),
  ].map((assetId) => ({
    assetId,
    texturePath: copy({ assetId, fileName: "baseColor.png" }),
    normalPath: copy({ assetId, fileName: "normal.png", optional: true }),
    roughnessPath: copy({ assetId, fileName: "roughness.png", optional: true }),
  }));
  const output = {
    widthPx: Math.max(
      1,
      Math.round(view.aspect >= 1 ? 1920 : 1920 * view.aspect),
    ),
    heightPx: Math.max(
      1,
      Math.round(view.aspect >= 1 ? 1920 / view.aspect : 1920),
    ),
    samples: 192,
  };
  const manifest = {
    version: 1,
    projectId: options.project.id,
    revision: options.project.revision,
    scene,
    view,
    assets,
    surfaces,
    output,
  };
  writeJson({ path: join(options.folder, "scene.json"), value: manifest });
  return manifest;
}
