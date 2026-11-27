import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { MAX_REFERENCE_PHOTOS } from "./max-reference-photos.ts";

export const RegenerationSpecSchema = z
  .object({
    itemId: IdSchema,
    notes: z.string().max(1000).optional(),
    photoIds: z
      .array(IdSchema)
      .min(1)
      .max(MAX_REFERENCE_PHOTOS)
      .refine((ids) => new Set(ids).size === ids.length, "Photo IDs repeat")
      .optional(),
    primaryPhotoId: IdSchema.optional(),
  })
  .strict();
