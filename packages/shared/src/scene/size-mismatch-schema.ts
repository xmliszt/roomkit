import { z } from "zod";

export const SizeMismatchSchema = z
  .object({
    axis: z.enum(["width", "height", "depth"]),
    actualM: z.number(),
    expectedM: z.number(),
  })
  .strict();
export type SizeMismatch = z.infer<typeof SizeMismatchSchema>;
