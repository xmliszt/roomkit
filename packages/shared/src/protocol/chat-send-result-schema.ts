import { z } from "zod";

export const ChatSendResultSchema = z
  .object({
    userMessageId: z.string().min(1),
    agentMessageId: z.string().min(1),
  })
  .strict();

export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;
