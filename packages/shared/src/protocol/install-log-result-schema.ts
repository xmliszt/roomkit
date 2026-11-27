import { z } from "zod";

export const InstallLogResultSchema = z
  .object({
    firstLineIndex: z.number().int().nonnegative(),
    lines: z.array(z.string()),
  })
  .strict();

export type InstallLogResult = z.infer<typeof InstallLogResultSchema>;
