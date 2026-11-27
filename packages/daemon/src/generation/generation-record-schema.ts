import { CommandSchema } from "@planner/shared/src/commands/command-schema.ts";
import { ExtraPhotoIdsSchema } from "@planner/shared/src/generation/extra-photo-ids-schema.ts";
import { GenerationReferenceSchema } from "@planner/shared/src/generation/generation-spec-schema.ts";
import { InventoryObjectSchema } from "@planner/shared/src/inventory/inventory-object-schema.ts";
import {
  AlternativeJobSchema,
  GenerationJobSchema,
} from "@planner/shared/src/jobs/job-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { ColorSchema } from "@planner/shared/src/scene/color-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { SizeMismatchSchema } from "@planner/shared/src/scene/size-mismatch-schema.ts";
import { SizeSchema } from "@planner/shared/src/scene/size-schema.ts";
import { z } from "zod";

export const GenerationRecordSchema = z.object({
  job: z.discriminatedUnion("kind", [
    GenerationJobSchema,
    AlternativeJobSchema,
  ]),
  item: ItemSchema,
  source: z.discriminatedUnion("kind", [
    ...GenerationReferenceSchema.options,
    z.object({
      kind: z.literal("inventory"),
      inventoryJobId: IdSchema,
      object: InventoryObjectSchema,
      extraPhotoIds: ExtraPhotoIdsSchema.optional(),
    }),
    z.object({ kind: z.literal("shape"), parentAssetId: IdSchema }),
    z.object({
      kind: z.literal("color"),
      parentAssetId: IdSchema,
      color: ColorSchema,
      strength: z.number().min(0).max(1),
      referenceLuma: z.number().positive(),
      nativeSizeM: SizeSchema,
    }),
  ]),
  prompt: z.string(),
  notes: z.string().max(1000).optional(),
  colorNotes: z.string().optional(),
  regeneration: z
    .object({
      sourcePath: z.string().optional(),
      publication: z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("prepared"), undo: CommandSchema }),
          z.object({
            kind: z.literal("applied"),
            undo: CommandSchema,
            revision: z.number().int().nonnegative(),
          }),
        ])
        .optional(),
    })
    .optional(),
  held: z.boolean(),
  attempt: z.number().int().min(0).max(1),
  gateFailure: z.string().optional(),
  sizeMismatches: z.array(SizeMismatchSchema).optional(),
  firstAttempt: z
    .object({
      meta: AssetMetaSchema,
      sizeMismatches: z.array(SizeMismatchSchema),
    })
    .optional(),
  assetId: IdSchema,
  prepared: AssetMetaSchema.optional(),
});
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;
