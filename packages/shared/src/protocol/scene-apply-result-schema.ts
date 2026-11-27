import { z } from "zod";

export const SceneApplyResultSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();

export type SceneApplyResult = z.infer<typeof SceneApplyResultSchema>;
