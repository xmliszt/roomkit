import { z } from "zod";
import { ColorSchema } from "./color-schema.ts";
import { IdSchema } from "./id-schema.ts";
import { SurfaceMaterialSchema } from "./surface-material-schema.ts";

export const SurfaceAssetMetaSchema = z
  .object({
    id: IdSchema,
    kind: z.literal("surface"),
    color: ColorSchema,
    material: SurfaceMaterialSchema,
    provenance: z
      .object({
        method: z.literal("surfacer"),
        prompt: z.string(),
        sourcePhotoIds: z.array(IdSchema),
      })
      .strict(),
  })
  .strict();
export type SurfaceAssetMeta = z.infer<typeof SurfaceAssetMetaSchema>;
