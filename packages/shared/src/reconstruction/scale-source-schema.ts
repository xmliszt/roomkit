import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { Vec3Schema } from "../scene/vec3-schema.ts";

const lengthM = z.number().finite().positive();
const label = z.string().trim().min(1).max(200).optional();
const axis = z.enum(["height", "width", "depth"]);
export const ScaleSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measurement"), axis, lengthM, label }).strict(),
  z
    .object({
      kind: z.literal("distance"),
      points: z.tuple([Vec3Schema, Vec3Schema]),
      lengthM,
      label,
    })
    .strict(),
  z
    .object({
      kind: z.literal("furniture"),
      photoId: IdSchema,
      box: z.tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().positive(),
        z.number().int().positive(),
      ]),
      axis,
      lengthM,
      label,
      floorStanding: z.boolean().optional(),
      direction: Vec3Schema.optional(),
    })
    .strict(),
]);
export const ScaleSourcesSchema = z
  .array(ScaleSourceSchema)
  .max(32)
  .superRefine((sources, context) => {
    for (const source of sources) {
      if (
        source.kind === "furniture" &&
        (source.box[2] <= source.box[0] || source.box[3] <= source.box[1])
      )
        context.addIssue({
          code: "custom",
          message: "Furniture box must have positive width and height",
        });
      if (
        source.kind === "distance" &&
        JSON.stringify(source.points[0]) === JSON.stringify(source.points[1])
      )
        context.addIssue({
          code: "custom",
          message: "Distance endpoints must differ",
        });
      if (
        source.kind === "furniture" &&
        source.direction &&
        source.direction.x === 0 &&
        source.direction.y === 0 &&
        source.direction.z === 0
      )
        context.addIssue({
          code: "custom",
          message: "Furniture direction must be nonzero",
        });
    }
  });
export type ScaleSource = z.infer<typeof ScaleSourceSchema>;
