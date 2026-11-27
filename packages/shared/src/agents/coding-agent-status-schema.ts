import { z } from "zod";
import { OffsetDateTimeSchema } from "../protocol/date-time-schema.ts";

export const CodingAgentUsageWindowSchema = z
  .object({
    label: z.string().min(1),
    usedPercent: z.number(),
    resetsAt: z.string().optional(),
  })
  .strict();

export const CodingAgentUsageSchema = z
  .object({
    plan: z.string().optional(),
    windows: z.array(CodingAgentUsageWindowSchema),
    error: z
      .object({
        kind: z.enum([
          "not-signed-in",
          "refused",
          "rate-limited",
          "http-status",
          "changed-shape",
          "timeout",
          "failed",
        ]),
        message: z.string().min(1),
      })
      .strict()
      .optional(),
    fetchedAt: OffsetDateTimeSchema,
  })
  .strict();

export const CodingAgentStatusSchema = z
  .object({
    cli: z.enum(["claude", "codex"]),
    path: z.string(),
    checkedAt: OffsetDateTimeSchema,
    version: z.string().optional(),
    status: z.enum(["not-installed", "error", "ready", "sign-in"]),
    message: z.string(),
    usage: CodingAgentUsageSchema.optional(),
  })
  .strict();

export type CodingAgentUsageWindow = z.infer<
  typeof CodingAgentUsageWindowSchema
>;
export type CodingAgentUsage = z.infer<typeof CodingAgentUsageSchema>;
export type CodingAgentStatus = z.infer<typeof CodingAgentStatusSchema>;
