import { z } from "zod";

export const Vec3Schema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();

export type Vec3 = z.infer<typeof Vec3Schema>;
