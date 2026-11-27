import { RoleSchema } from "@planner/shared/src/config/config-schema.ts";
import { z } from "zod";

const UsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});

export const SessionRecordSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*-\d+$/),
  role: RoleSchema,
  cli: z.enum(["claude", "codex"]),
  model: z.string(),
  sessionId: z.string().optional(),
  transcriptNumber: z.number().int().positive().optional(),
  turns: z.number(),
  durationMs: z.number().nonnegative().default(0),
  usage: UsageSchema,
  codexUsage: UsageSchema.optional(),
  costUsd: z.number(),
  sessionCostUsd: z.number().default(0),
  tokens: z.number(),
  status: z.enum([
    "running",
    "idle",
    "interrupted",
    "timeout",
    "usage_limit",
    "error",
  ]),
  createdAt: z.string(),
  lastTurnAt: z.string(),
  note: z.string(),
  pid: z.number().int().positive().optional(),
  processIdentity: z
    .object({ bootId: z.string(), startedAt: z.string() })
    .optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
