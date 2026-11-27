import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { ObjectsLibraryResultSchema } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { getSourceOrigin } from "./get-source-origin.ts";
import { readGenerationRecords } from "./read-generation-records.ts";
import { readObjectJson } from "./read-object-json.ts";
import { readSavedGenerationReference } from "./read-saved-generation-reference.ts";

export function readObjectsLibrary(options: {
  folder: string;
  project: Project;
  isArchived?: boolean;
}) {
  const records = readGenerationRecords({
    folder: options.folder,
    projectId: options.project.id,
  });
  function itemIds(assetId: string) {
    return options.project.scene.items
      .filter(
        (item) => item.model.kind === "asset" && item.model.assetId === assetId,
      )
      .map((item) => item.id);
  }
  const relativeFolder = options.isArchived ? ".planner/archive" : "assets";
  const folder = join(options.folder, relativeFolder);
  const assets = existsSync(folder)
    ? readdirSync(
        jobFilePath({ folder: options.folder, path: relativeFolder }),
        {
          withFileTypes: true,
        },
      )
    : [];
  const objects = assets.flatMap((entry) => {
    if (
      !entry.isDirectory() ||
      !IdSchema.safeParse(entry.name).success ||
      CHARGING_PORT_TYPES.some((type) => type.assetId === entry.name)
    )
      return [];
    const relativePath = join(relativeFolder, entry.name, "meta.json");
    const meta = AssetMetaSchema.safeParse(
      readObjectJson({ folder: options.folder, path: relativePath }),
    );
    if (!meta.success || meta.data.id !== entry.name) return [];
    const path = jobFilePath({ folder: options.folder, path: relativePath });
    const record = records.findLast((record) => record.assetId === entry.name);
    const ids = itemIds(entry.name);
    const itemName = options.project.scene.items.find((item) =>
      ids.includes(item.id),
    )?.name;
    const recordName = record?.item.name;
    const name = itemName?.trim()
      ? itemName
      : recordName?.trim()
        ? recordName
        : "Untitled model";
    return [
      {
        assetId: entry.name,
        name,
        nativeSizeM: meta.data.nativeSizeM,
        mount: meta.data.mount,
        thumbUrl: `/projects/${options.project.id}/assets/${entry.name}/thumb.png${options.isArchived ? "?archived=1" : ""}`,
        origin: getSourceOrigin({
          source:
            record?.source ??
            readSavedGenerationReference({
              folder: options.folder,
              assetId: entry.name,
              isArchived: options.isArchived === true,
            }),
          isCatalog: meta.data.kind === "catalog",
          isVariant: meta.data.kind === "variant",
        }),
        createdAt: record
          ? new Date(record.job.createdAt).toISOString()
          : statSync(path).mtime.toISOString(),
        itemIds: ids,
        builtIn: false,
      },
    ];
  });
  const builtIn = (options.isArchived ? [] : CHARGING_PORT_TYPES).map(
    (entry) => ({
      assetId: entry.assetId,
      name: entry.label,
      nativeSizeM: entry.sizeM,
      mount: entry.mount,
      thumbUrl: `/catalog/${entry.assetId}/thumb.png`,
      origin: "catalog",
      createdAt: "1970-01-01T00:00:00.000Z",
      itemIds: itemIds(entry.assetId),
      builtIn: true,
    }),
  );
  return ObjectsLibraryResultSchema.parse({
    objects: [...objects, ...builtIn].toSorted(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        a.assetId.localeCompare(b.assetId),
    ),
  });
}
