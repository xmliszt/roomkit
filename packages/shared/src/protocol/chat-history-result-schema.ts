import { z } from "zod";
import { ChatMessageSchema } from "../chat/chat-message-schema.ts";

export const ChatHistoryResultSchema = z
  .object({ messages: z.array(ChatMessageSchema) })
  .strict();

export type ChatHistoryResult = z.infer<typeof ChatHistoryResultSchema>;
