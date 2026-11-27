import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { MAX_REFERENCE_PHOTOS } from "./max-reference-photos.ts";

export const ExtraPhotoIdsSchema = z
  .array(IdSchema)
  .max(MAX_REFERENCE_PHOTOS - 1)
  .refine((ids) => new Set(ids).size === ids.length, "Photo IDs repeat");
