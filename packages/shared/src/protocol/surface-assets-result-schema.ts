import { z } from "zod";
import { ColorSchema } from "../scene/color-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { repeatSize, roughness } from "../scene/surface-material-schema.ts";
import { UtcDateTimeSchema } from "./date-time-schema.ts";

const common = {
  assetId: IdSchema,
  color: ColorSchema,
  roughness,
  sourceSurfaceId: IdSchema.optional(),
  createdAt: UtcDateTimeSchema,
};

export const SurfaceAssetsResultSchema = z
  .object({
    assets: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            ...common,
            kind: z.literal("texture"),
            repeatSizeM: repeatSize,
          })
          .strict(),
        z
          .object({
            ...common,
            kind: z.literal("tiles"),
            tileSizeM: repeatSize,
          })
          .strict(),
        z
          .object({
            ...common,
            kind: z.literal("planks"),
            plankSizeM: repeatSize,
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type SurfaceAsset = z.infer<
  typeof SurfaceAssetsResultSchema
>["assets"][number];
