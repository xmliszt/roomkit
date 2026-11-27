import { z } from "zod";

const FractionSchema = z.number().min(0).max(1);
const UnitSchema = z.number().min(-1).max(1);

export const BeamSchema = z
  .object({
    direction: z
      .object({ x: UnitSchema, y: UnitSchema, z: UnitSchema })
      .strict()
      .refine(
        (direction) =>
          Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) <=
          0.01,
        "A beam direction must be a unit vector",
      ),
    angleDeg: z.number().min(10).max(170),
  })
  .strict();

export type Beam = z.infer<typeof BeamSchema>;

export const LightSchema = z
  .object({
    on: z.boolean(),
    emitter: z
      .object({ x: FractionSchema, y: FractionSchema, z: FractionSchema })
      .strict(),
    beam: BeamSchema.optional(),
    shade: z.enum(["opaque", "translucent"]).optional(),
    lumens: z.number().positive().max(20_000),
    temperatureK: z.number().min(1500).max(8000),
  })
  .strict();

export type Light = z.infer<typeof LightSchema>;
