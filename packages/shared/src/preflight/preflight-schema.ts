import { z } from "zod";
import { CodingAgentStatusSchema } from "../agents/coding-agent-status-schema.ts";
import { ModelIdSchema } from "../jobs/install-target-schema.ts";
import { OffsetDateTimeSchema } from "../protocol/date-time-schema.ts";

export const ToolCheckSchema = z
  .object({
    state: z.enum(["present", "missing", "error"]),
    path: z.string(),
    version: z.string().optional(),
    message: z.string(),
  })
  .strict();

export const ModelWeightsSchema = z
  .object({
    id: ModelIdSchema,
    name: z.string().min(1),
    path: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    remainingDownloadBytes: z.number().int().nonnegative().optional(),
    expectedSizeBytes: z.number().int().nonnegative(),
    state: z.enum(["missing", "partial", "present"]),
  })
  .strict();

export const PreflightSchema = z
  .object({
    checkedAt: OffsetDateTimeSchema,
    agents: z.array(CodingAgentStatusSchema),
    brew: ToolCheckSchema.optional(),
    device: z
      .object({
        memoryBytes: z.number().int().positive(),
        localStorageBytes: z.number().int().nonnegative().optional(),
        pythonStorageBytes: z.number().int().nonnegative().optional(),
        modelStorageBytes: z.number().int().nonnegative().optional(),
        localVolume: z.number().int().optional(),
        pythonVolume: z.number().int().optional(),
        modelVolume: z.number().int().optional(),
        appleSilicon: z.boolean(),
      })
      .strict()
      .optional(),
    blender: ToolCheckSchema,
    uv: ToolCheckSchema,
    pythonEnv: ToolCheckSchema,
    models: z.array(ModelWeightsSchema),
  })
  .strict();

export type ToolCheck = z.infer<typeof ToolCheckSchema>;
export type ModelWeights = z.infer<typeof ModelWeightsSchema>;
export type Preflight = z.infer<typeof PreflightSchema>;
