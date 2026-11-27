import { z } from "zod";
import { IdSchema } from "./id-schema.ts";
import { Vec2Schema } from "./vec2-schema.ts";

export const WallSchema = z
  .object({
    id: IdSchema,
    startM: Vec2Schema,
    kind: z.enum(["solid", "open", "inferred"]),
  })
  .strict();

export type Wall = z.infer<typeof WallSchema>;
