import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "./generation-record-schema.ts";
import { jobFilePath } from "./job-file-path.ts";

export function readRegenerationSource(options: {
  projectFolder: string;
  item: Item;
  previous: GenerationRecord | undefined;
  isAlternative?: boolean;
  records?: GenerationRecord[];
}) {
  function readSaved(sourcePath: string | undefined) {
    if (!sourcePath) return undefined;
    const path = join(sourcePath, "job.json");
    if (!existsSync(join(options.projectFolder, path))) return undefined;
    return z
      .object({
        reference: GenerationRecordSchema.shape.source,
        colorNotes: z.string().optional(),
      })
      .parse(
        JSON.parse(
          readFileSync(
            jobFilePath({ folder: options.projectFolder, path }),
            "utf8",
          ),
        ),
      );
  }
  function isAlternativeAsset(assetId: string) {
    const path = join("assets", assetId, "meta.json");
    if (!existsSync(join(options.projectFolder, path))) return false;
    const meta = AssetMetaSchema.parse(
      JSON.parse(
        readFileSync(
          jobFilePath({ folder: options.projectFolder, path }),
          "utf8",
        ),
      ),
    );
    return ["trellis2", "sam3d"].includes(meta.provenance.method);
  }
  function originalSource(input: {
    source: GenerationRecord["source"];
    sourcePath: string | undefined;
    parentAssetIds: string[];
  }): {
    source: Exclude<GenerationRecord["source"], { kind: "color" }>;
    sourcePath: string | undefined;
  } {
    if (input.source.kind !== "color")
      return {
        source: input.source,
        sourcePath: input.sourcePath,
      };
    const parentAssetId = input.source.parentAssetId;
    if (input.parentAssetIds.includes(parentAssetId))
      throw new Error("Colour variant sources contain a cycle");
    const sourcePath = join("assets", parentAssetId, "source");
    const saved = readSaved(sourcePath);
    const parent = options.records?.findLast(
      (record) => record.assetId === parentAssetId,
    );
    const isAlternative =
      parent?.job.kind === "generation-alternative" ||
      isAlternativeAsset(parentAssetId);
    const previous =
      isAlternative && parent
        ? options.records?.findLast(
            (record) =>
              record.job.kind === "generation" &&
              record.job.projectId === parent.job.projectId &&
              record.job.itemId === parent.job.itemId,
          )
        : parent;
    const source = previous?.source ?? saved?.reference;
    if (!source)
      throw new Error("Generation source is unavailable for this item");
    return originalSource({
      source,
      sourcePath: saved && !isAlternative ? sourcePath : undefined,
      parentAssetIds: [...input.parentAssetIds, parentAssetId],
    });
  }
  const model = options.item.model;
  const isAlternative =
    options.isAlternative ||
    (model.kind === "asset" && isAlternativeAsset(model.assetId));
  const sourcePath =
    model.kind === "asset"
      ? join("assets", model.assetId, "source")
      : options.previous
        ? join(".planner", "generation", options.previous.job.id)
        : undefined;
  const saved = readSaved(sourcePath);
  const source = options.previous?.source ?? saved?.reference;
  if (!source)
    throw new Error("Generation source is unavailable for this item");
  const original = originalSource({
    source,
    sourcePath: saved && !isAlternative ? sourcePath : undefined,
    parentAssetIds: [],
  });
  return {
    ...original,
    sourcePath: isAlternative ? undefined : original.sourcePath,
    prompt: isAlternative
      ? options.item.name
      : (options.previous?.prompt ?? options.item.name),
    colorNotes:
      source.kind === "color"
        ? `Use colour ${source.color} at strength ${source.strength}.`
        : (options.previous?.colorNotes ?? saved?.colorNotes),
  };
}
