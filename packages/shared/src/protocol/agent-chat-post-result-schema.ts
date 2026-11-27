import { z } from "zod";

export const AgentChatPostResultSchema = z
  .object({ posted: z.number().int().positive() })
  .strict();

export type AgentChatPostResult = z.infer<typeof AgentChatPostResultSchema>;
