import { z } from "zod";
import { IdSchema } from "./id-schema.ts";

export const PlacementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("floor"),
      xM: z.number().finite(),
      zM: z.number().finite(),
      elevationM: z.number().finite().nonnegative(),
      rotationRad: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wall"),
      wallId: IdSchema,
      alongM: z.number().finite(),
      heightM: z.number().finite().nonnegative(),
      rotationRad: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ceiling"),
      xM: z.number().finite(),
      zM: z.number().finite(),
      rotationRad: z.number().finite(),
    })
    .strict(),
]);

export type Placement = z.infer<typeof PlacementSchema>;
