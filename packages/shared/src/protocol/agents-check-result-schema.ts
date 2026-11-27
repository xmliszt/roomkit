import { z } from "zod";
import { CodingAgentStatusSchema } from "../agents/coding-agent-status-schema.ts";

export const AgentsCheckResultSchema = z
  .object({ agents: z.array(CodingAgentStatusSchema) })
  .strict();

export type AgentsCheckResult = z.infer<typeof AgentsCheckResultSchema>;
