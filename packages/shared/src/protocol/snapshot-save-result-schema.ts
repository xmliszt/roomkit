import { z } from "zod";

export const SnapshotSaveResultSchema = z
  .object({ fileName: z.string().regex(/^[0-9TZ-]+\.png$/) })
  .strict();

export type SnapshotSaveResult = z.infer<typeof SnapshotSaveResultSchema>;
