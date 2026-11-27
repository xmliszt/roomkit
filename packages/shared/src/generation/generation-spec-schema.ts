import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { PlacementSchema } from "../scene/placement-schema.ts";
import { SizeSchema } from "../scene/size-schema.ts";
import { ExtraPhotoIdsSchema } from "./extra-photo-ids-schema.ts";

export const GenerationReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("photo"),
      photoId: IdSchema,
      extraPhotoIds: ExtraPhotoIdsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("web"),
      imageUrl: z.string().url(),
      sourceUrl: z.string().url(),
    })
    .strict(),
]);
export const GenerationSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    sizeM: SizeSchema,
    placement: PlacementSchema,
    prompt: z.string().trim().min(1).max(16000),
    reference: GenerationReferenceSchema,
    cutsOpening: z.boolean().optional(),
  })
  .strict()
  .refine(
    (spec) =>
      spec.reference.kind !== "photo" ||
      !spec.reference.extraPhotoIds?.includes(spec.reference.photoId),
    {
      message: "extraPhotoIds must not repeat photoId",
      path: ["reference", "extraPhotoIds"],
    },
  );
export type GenerationSpec = z.infer<typeof GenerationSpecSchema>;
