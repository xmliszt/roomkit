import { z } from "zod";
import { IdSchema } from "./id-schema.ts";
import { SizeSchema } from "./size-schema.ts";

export const AssetMetaSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(["catalog", "reconstructed", "generated", "variant"]),
    nativeSizeM: SizeSchema,
    mount: z.enum(["floor", "wall", "ceiling"]),
    triangleCount: z.number().int().nonnegative(),
    hasColorMask: z.boolean(),
    parentAssetId: IdSchema.optional(),
    referenceLuma: z.number().gt(0).max(1).optional(),
    provenance: z
      .object({
        method: z.string().min(1),
        prompt: z.string().optional(),
        sourcePhotoIds: z.array(IdSchema),
      })
      .strict(),
  })
  .strict();

export type AssetMeta = z.infer<typeof AssetMetaSchema>;
