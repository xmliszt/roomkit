import { BulbJobSchema } from "@planner/shared/src/jobs/job-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import {
  BeamSchema,
  LightSchema,
} from "@planner/shared/src/scene/light-schema.ts";
import { z } from "zod";

const EmitterSchema = LightSchema.shape.emitter;

export const BulbRecordSchema = z.object({
  job: BulbJobSchema,
  assetId: IdSchema.optional(),
  emitterAtStart: EmitterSchema.optional(),
  lumensAtStart: LightSchema.shape.lumens.optional(),
  isLumensDefaultAtStart: z.boolean().optional(),
  outcome: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("placed"),
        emitter: EmitterSchema,
        beam: BeamSchema.nullable().optional(),
        shade: LightSchema.shape.shade,
        lumens: LightSchema.shape.lumens.optional(),
        revision: z.number().int().nonnegative().optional(),
      }),
      z.object({ kind: z.literal("kept-default"), reason: z.string() }),
    ])
    .optional(),
});
export type BulbRecord = z.infer<typeof BulbRecordSchema>;
