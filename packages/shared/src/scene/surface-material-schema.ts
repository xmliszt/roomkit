import { z } from "zod";
import { ColorSchema } from "./color-schema.ts";
import { IdSchema } from "./id-schema.ts";

export const repeatSize = z
  .object({
    u: z.number().finite().min(0.05).max(3),
    v: z.number().finite().min(0.05).max(3),
  })
  .strict();
export const roughness = z.number().finite().min(0).max(1);
export const SurfaceMaterialSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("paint"),
        color: ColorSchema,
        finish: z.enum(["matte", "eggshell", "satin"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("tiles"),
        tileSizeM: repeatSize,
        groutWidthM: z.number().finite().min(0).max(0.05),
        groutColor: ColorSchema,
        baseColor: ColorSchema,
        roughness,
        textureAssetId: IdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("planks"),
        plankSizeM: repeatSize,
        baseColor: ColorSchema,
        roughness,
        textureAssetId: IdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("texture"),
        repeatSizeM: repeatSize,
        roughness,
        textureAssetId: IdSchema,
      })
      .strict(),
  ])
  .refine(
    (material) =>
      material.kind !== "tiles" ||
      material.groutWidthM <
        Math.min(material.tileSizeM.u, material.tileSizeM.v),
    "Grout must be narrower than the tile",
  );
export type SurfaceMaterial = z.infer<typeof SurfaceMaterialSchema>;
