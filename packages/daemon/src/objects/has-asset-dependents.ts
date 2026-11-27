import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { z } from "zod";
import { jobFilePath } from "../generation/job-file-path.ts";
import { readGenerationRecords } from "./read-generation-records.ts";
import { readObjectJson } from "./read-object-json.ts";

export function hasAssetDependents(options: {
  folder: string;
  projectId: string;
  assetId: string;
}) {
  const assets = existsSync(join(options.folder, "assets"))
    ? readdirSync(jobFilePath({ folder: options.folder, path: "assets" }), {
        withFileTypes: true,
      })
    : [];
  const hasModel = assets.some((entry) => {
    if (!entry.isDirectory() || !IdSchema.safeParse(entry.name).success)
      return false;
    const meta = z.object({ parentAssetId: IdSchema.optional() }).safeParse(
      readObjectJson({
        folder: options.folder,
        path: join("assets", entry.name, "meta.json"),
      }),
    );
    return meta.success && meta.data.parentAssetId === options.assetId;
  });
  return (
    hasModel ||
    readGenerationRecords(options).some(
      (record) =>
        ["queued", "generating"].includes(record.job.stage) &&
        "parentAssetId" in record.source &&
        record.source.parentAssetId === options.assetId,
    )
  );
}
