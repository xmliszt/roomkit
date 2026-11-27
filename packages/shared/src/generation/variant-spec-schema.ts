import { z } from "zod";
import { ColorSchema } from "../scene/color-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { SizeSchema } from "../scene/size-schema.ts";

export const VariantSpecSchema = z
  .object({
    itemId: IdSchema,
    name: z.string().trim().min(1).max(200),
    change: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("color"),
          color: ColorSchema,
          strength: z.number().min(0).max(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("shape"),
          prompt: z.string().trim().min(1).max(16000),
          sizeM: SizeSchema,
        })
        .strict(),
    ]),
  })
  .strict();
export type VariantSpec = z.infer<typeof VariantSpecSchema>;
