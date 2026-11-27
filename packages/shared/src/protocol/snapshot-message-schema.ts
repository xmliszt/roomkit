import { z } from "zod";
import { ConfigSchema } from "../config/config-schema.ts";
import { JobSchema } from "../jobs/job-schema.ts";
import { ProjectSummarySchema } from "../project/project-schema.ts";
import { OffsetDateTimeSchema } from "./date-time-schema.ts";

export const SnapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  config: ConfigSchema,
  at: OffsetDateTimeSchema,
  projects: z.array(ProjectSummarySchema),
  jobs: z.array(JobSchema),
});

export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
