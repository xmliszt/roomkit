import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type SurfaceAsset,
  SurfaceAssetsResultSchema,
} from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { SurfaceAssetMetaSchema } from "@planner/shared/src/scene/surface-asset-meta-schema.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { SurfaceRecordSchema } from "./surface-record-schema.ts";

export function readSurfaceAssets(options: {
  projectFolder: string;
  room: Room;
}) {
  const root = join(options.projectFolder, "assets");
  const savedRecords = (() => {
    try {
      return readProjectJobRecords(options.projectFolder);
    } catch {
      return [];
    }
  })();
  const records = savedRecords.flatMap((record) => {
    const parsed = SurfaceRecordSchema.safeParse(record);
    return parsed.success ? [parsed.data] : [];
  });
  const recordsByAssetId = Object.fromEntries(
    records.map(
      (record) =>
        [record.assetId, record] satisfies [string, (typeof records)[number]],
    ),
  );
  const usedAssetIds = new Set(
    Object.values(options.room.surfaces).flatMap((surface) =>
      surface.material &&
      surface.material.kind !== "paint" &&
      surface.material.textureAssetId
        ? [surface.material.textureAssetId]
        : [],
    ),
  );
  const assets = (
    lstatSync(root, { throwIfNoEntry: false })?.isDirectory()
      ? readdirSync(root, { withFileTypes: true })
      : []
  ).flatMap<SurfaceAsset>((entry) => {
    if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success)
      return [];
    const path = join(root, entry.name, "meta.json");
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (
      !stats?.isFile() ||
      !lstatSync(join(root, entry.name, "baseColor.png"), {
        throwIfNoEntry: false,
      })?.isFile()
    )
      return [];
    const parsed = (() => {
      try {
        return SurfaceAssetMetaSchema.safeParse(
          JSON.parse(readFileSync(path, "utf8")),
        );
      } catch {
        return undefined;
      }
    })();
    if (
      !parsed?.success ||
      parsed.data.id !== entry.name ||
      parsed.data.material.kind === "paint"
    )
      return [];
    const meta = parsed.data;
    const record = Object.hasOwn(recordsByAssetId, meta.id)
      ? recordsByAssetId[meta.id]
      : undefined;
    if (record?.job.stage !== "ready" && !usedAssetIds.has(meta.id)) return [];
    const common = {
      assetId: meta.id,
      color: meta.color,
      sourceSurfaceId: record?.job.surfaceId,
      createdAt: new Date(
        record?.job.createdAt ?? (stats.birthtimeMs || stats.mtimeMs),
      ).toISOString(),
    };
    const material = meta.material;
    switch (material.kind) {
      case "texture":
        return [
          {
            ...common,
            kind: material.kind,
            repeatSizeM: material.repeatSizeM,
            roughness: material.roughness,
          },
        ];
      case "tiles":
        return [
          {
            ...common,
            kind: material.kind,
            tileSizeM: material.tileSizeM,
            roughness: material.roughness,
          },
        ];
      case "planks":
        return [
          {
            ...common,
            kind: material.kind,
            plankSizeM: material.plankSizeM,
            roughness: material.roughness,
          },
        ];
      case "paint":
        return [];
      default: {
        const unreachable: never = material;
        return unreachable;
      }
    }
  });
  return SurfaceAssetsResultSchema.parse({
    assets: assets.toSorted(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        a.assetId.localeCompare(b.assetId),
    ),
  });
}
