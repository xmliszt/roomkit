import { z } from "zod";
import { ColorSchema } from "./color-schema.ts";

export const ColorAdjustSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("shift"),
      hueShiftDeg: z.number().min(-180).max(180),
      saturation: z.number().min(-1).max(1),
      lightness: z.number().min(-1).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("colorize"),
      color: ColorSchema,
      strength: z.number().min(0).max(1),
    })
    .strict(),
]);

export type ColorAdjust = z.infer<typeof ColorAdjustSchema>;
