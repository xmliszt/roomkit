import { join } from "node:path";
import { z } from "zod";
import { GenerationRecordSchema } from "../generation/generation-record-schema.ts";
import { readObjectJson } from "./read-object-json.ts";

export function readSavedGenerationReference(options: {
  folder: string;
  assetId: string;
  isArchived?: boolean;
}) {
  const path = join(
    options.isArchived ? ".planner/archive" : "assets",
    options.assetId,
    "source",
    "job.json",
  );
  const saved = z
    .object({
      reference: GenerationRecordSchema.shape.source.refine(
        (source) =>
          source.kind !== "web" ||
          (URL.canParse(source.sourceUrl) &&
            /^https?:$/.test(new URL(source.sourceUrl).protocol)),
      ),
    })
    .safeParse(readObjectJson({ folder: options.folder, path }));
  return saved.success ? saved.data.reference : undefined;
}
