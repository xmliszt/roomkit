import { z } from "zod";
import { ColorAdjustSchema } from "./color-adjust-schema.ts";
import { IdSchema } from "./id-schema.ts";
import { LightSchema } from "./light-schema.ts";
import { PlacementSchema } from "./placement-schema.ts";
import { SizeSchema } from "./size-schema.ts";

export const ItemModelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending"), jobId: IdSchema }).strict(),
  z.object({ kind: z.literal("asset"), assetId: IdSchema }).strict(),
]);

export const ItemSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    model: ItemModelSchema,
    placement: PlacementSchema,
    sizeM: SizeSchema,
    colorAdjust: ColorAdjustSchema.optional(),
    mirrored: z.boolean().optional(),
    cutsOpening: z.boolean().optional(),
    light: LightSchema.optional(),
    locked: z.boolean(),
  })
  .strict();

export type Item = z.infer<typeof ItemSchema>;
