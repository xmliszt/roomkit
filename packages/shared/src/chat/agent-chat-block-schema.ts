import type { z } from "zod";
import { ChatBlockSchema } from "./chat-block-schema.ts";

export const AgentChatBlockSchema = ChatBlockSchema.refine(
  (block) =>
    block.kind !== "text" &&
    block.kind !== "render" &&
    block.kind !== "item" &&
    block.kind !== "tool" &&
    block.kind !== "job" &&
    block.kind !== "diff" &&
    block.kind !== "notice",
  {
    message:
      "Agents post only image, video, link, file, asset, capture-request and choice blocks",
  },
);

export type AgentChatBlock = z.infer<typeof AgentChatBlockSchema>;
