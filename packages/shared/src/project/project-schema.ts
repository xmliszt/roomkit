import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import { ProjectIdSchema } from "./project-id-schema.ts";

export const ProjectSummarySchema = z
  .object({
    id: ProjectIdSchema,
    name: z.string().min(1),
    sample: z.literal(true).optional(),
  })
  .strict();

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectSchema = z
  .object({
    id: ProjectIdSchema,
    name: z.string().min(1),
    sample: z.literal(true).optional(),
    revision: z.number().int().nonnegative(),
    scene: SceneSchema,
    reconstruction: z
      .object({ jobId: z.guid(), weakScale: z.boolean() })
      .strict()
      .optional(),
    inventory: z
      .object({
        jobId: IdSchema,
        appliedItemIds: z
          .array(IdSchema)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Applied inventory item IDs must be unique",
          ),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;
