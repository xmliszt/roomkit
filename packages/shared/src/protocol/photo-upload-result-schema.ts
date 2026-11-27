import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const PhotoUploadResultSchema = z
  .object({ photoId: IdSchema, fileName: z.string().min(1) })
  .strict();

export type PhotoUploadResult = z.infer<typeof PhotoUploadResultSchema>;
