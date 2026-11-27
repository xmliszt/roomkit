import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const BulbFindResultSchema = z.object({ jobId: IdSchema }).strict();

export type BulbFindResult = z.infer<typeof BulbFindResultSchema>;
