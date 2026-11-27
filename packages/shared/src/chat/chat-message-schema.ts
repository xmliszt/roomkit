import { z } from "zod";
import { RoleSchema } from "../config/config-schema.ts";
import { OffsetDateTimeSchema } from "../protocol/date-time-schema.ts";
import { ChatBlockSchema } from "./chat-block-schema.ts";
import { ChatMessageStatusSchema } from "./chat-message-status-schema.ts";

export const ChatMessageSchema = z
  .object({
    id: z.string().min(1),
    author: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("user") }).strict(),
      z.object({ kind: z.literal("agent"), role: RoleSchema }).strict(),
    ]),
    blocks: z.array(ChatBlockSchema),
    status: ChatMessageStatusSchema,
    createdAt: OffsetDateTimeSchema,
  })
  .strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
