import { existsSync } from "node:fs";
import { join } from "node:path";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "../generation/generation-record-schema.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { readObjectJson } from "./read-object-json.ts";

const ReferenceSchema = GenerationRecordSchema.shape.source.refine(
  (source) =>
    source.kind !== "web" ||
    (URL.canParse(source.sourceUrl) &&
      /^https?:$/.test(new URL(source.sourceUrl).protocol)),
);

export function readItemSource(options: {
  folder: string;
  item: Item;
  records: GenerationRecord[];
}) {
  function resolveSource(input: {
    record: GenerationRecord | undefined;
    sourcePath: string | undefined;
    parentAssetIds: string[];
  }):
    | {
        source: Exclude<GenerationRecord["source"], { kind: "color" }>;
        folder: string | undefined;
      }
    | undefined {
    const saved = input.sourcePath
      ? z.object({ reference: ReferenceSchema }).safeParse(
          readObjectJson({
            folder: options.folder,
            path: join(input.sourcePath, "job.json"),
          }),
        )
      : undefined;
    const reference = ReferenceSchema.safeParse(
      input.record?.source ??
        (saved?.success ? saved.data.reference : undefined),
    );
    if (!reference.success) return undefined;
    const source = reference.data;
    if (source.kind === "color") {
      if (input.parentAssetIds.includes(source.parentAssetId)) return undefined;
      return resolveSource({
        record: options.records.findLast(
          (record) => record.assetId === source.parentAssetId,
        ),
        sourcePath: join("assets", source.parentAssetId, "source"),
        parentAssetIds: [...input.parentAssetIds, source.parentAssetId],
      });
    }
    const folder =
      input.sourcePath &&
      saved?.success &&
      existsSync(join(options.folder, input.sourcePath))
        ? jobFilePath({ folder: options.folder, path: input.sourcePath })
        : undefined;
    return { source, folder };
  }
  const model = options.item.model;
  if (model.kind === "asset") {
    const path = join("assets", model.assetId, "meta.json");
    if (
      existsSync(join(options.folder, path)) &&
      !AssetMetaSchema.safeParse(
        readObjectJson({ folder: options.folder, path }),
      ).success
    )
      return undefined;
  }
  const record = options.records.findLast((record) =>
    model.kind === "asset"
      ? record.assetId === model.assetId
      : record.job.id === model.jobId,
  );
  const sourcePath =
    model.kind === "asset"
      ? join("assets", model.assetId, "source")
      : record
        ? join(".planner", "generation", record.job.id)
        : undefined;
  try {
    return resolveSource({ record, sourcePath, parentAssetIds: [] });
  } catch {
    return undefined;
  }
}
