import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const JobCancelResultSchema = z
  .object({
    jobId: IdSchema,
    stage: z.enum(["held", "cancelled"]),
  })
  .strict();
