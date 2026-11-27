import { ChatBlockSchema } from "@planner/shared/src/chat/chat-block-schema.ts";
import { CommandSchema } from "@planner/shared/src/commands/command-schema.ts";
import { ReconstructionJobSchema } from "@planner/shared/src/jobs/job-schema.ts";
import { ScaleSourcesSchema } from "@planner/shared/src/reconstruction/scale-source-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { z } from "zod";

export const JobRecordSchema = z.object({
  job: ReconstructionJobSchema,
  photoIds: z.array(IdSchema).min(2),
  sources: ScaleSourcesSchema,
  artifacts: z
    .object({
      scenePath: z.string().min(1),
      camerasPath: z.string().min(1),
      pointsPath: z.string().min(1).optional(),
    })
    .strict()
    .optional(),
  outcome: z
    .object({
      command: CommandSchema,
      undo: CommandSchema,
      weakScale: z.boolean(),
      blocks: z.array(ChatBlockSchema),
    })
    .optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;
