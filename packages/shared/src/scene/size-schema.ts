import { z } from "zod";

export const SizeSchema = z
  .object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    depth: z.number().finite().positive(),
  })
  .strict();

export type Size = z.infer<typeof SizeSchema>;
