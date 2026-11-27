import { z } from "zod";
import { ColorSchema } from "./color-schema.ts";
import { IdSchema } from "./id-schema.ts";
import { SurfaceMaterialSchema } from "./surface-material-schema.ts";
import { WallSchema } from "./wall-schema.ts";

export const RoomSchema = z
  .object({
    walls: z.array(WallSchema).min(3),
    ceilingHeightM: z.number().finite().positive(),
    surfaces: z.record(
      IdSchema,
      z
        .object({
          color: ColorSchema,
          material: SurfaceMaterialSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type Room = z.infer<typeof RoomSchema>;
