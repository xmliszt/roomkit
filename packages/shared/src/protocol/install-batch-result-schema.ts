import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const InstallBatchResultSchema = z
  .object({
    jobIds: z.array(IdSchema),
  })
  .strict();
