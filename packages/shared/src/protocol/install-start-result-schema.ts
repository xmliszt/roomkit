import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const InstallStartResultSchema = z.object({ jobId: IdSchema }).strict();

export type InstallStartResult = z.infer<typeof InstallStartResultSchema>;
