import { z } from "zod";

export const Vec2Schema = z
  .object({ x: z.number().finite(), z: z.number().finite() })
  .strict();

export type Vec2 = z.infer<typeof Vec2Schema>;
