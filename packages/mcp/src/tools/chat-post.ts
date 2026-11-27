import { AgentChatBlockSchema } from "@planner/shared/src/chat/agent-chat-block-schema.ts";
import { z } from "zod";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const chatPost: Tool = {
  name: "chat_post",
  description:
    "Add rich blocks to your chat reply: image, video, link, file, asset, capture-request or choice. Never plain text; write text as your normal reply.",
  inputSchema: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: { type: "object" },
        minItems: 1,
        description:
          "Blocks with a kind field, e.g. {kind:'choice', choiceId, question, options:[{id,label}]} or {kind:'link', url, domain}",
      },
    },
    required: ["blocks"],
    additionalProperties: false,
  },
  async call(input, context) {
    const { blocks } = z
      .object({ blocks: z.array(AgentChatBlockSchema).min(1) })
      .strict()
      .parse(input);
    await requestOrThrow({
      context,
      command: {
        type: "agent.chat.post",
        projectId: context.projectId,
        turnId: context.turnId,
        blocks,
      },
    });
    return { posted: blocks.length };
  },
};
