import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import {
  type ChatMessage,
  ChatMessageSchema,
} from "@planner/shared/src/chat/chat-message-schema.ts";
import { z } from "zod";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import { writeJson } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";

/** Keep each project's chat in memory and in `.planner/chat.json`, and publish a chat event for every change. */
export function createChatStore(options: {
  bus: EventBus;
  projectPath: (projectId: string) => string;
}) {
  const loaded: { [projectId: string]: ChatMessage[] } = Object.create(null);
  const removedProjectIds = new Set<string>();

  function chatPath(projectId: string) {
    return join(options.projectPath(projectId), ".planner", "chat.json");
  }

  function load(projectId: string) {
    if (Object.hasOwn(loaded, projectId)) return loaded[projectId] ?? [];
    const messages = (() => {
      try {
        return z
          .array(ChatMessageSchema)
          .parse(JSON.parse(readFileSync(chatPath(projectId), "utf8")))
          .map((message) =>
            message.status === "streaming"
              ? { ...message, status: "stopped" as const }
              : message,
          );
      } catch (error) {
        if (isMissingPathError(error)) return [];
        throw error;
      }
    })();
    loaded[projectId] = messages;
    return messages;
  }

  function save(projectId: string) {
    writeJson({ path: chatPath(projectId), value: load(projectId) });
  }

  function findMessage(options: { projectId: string; messageId: string }) {
    if (removedProjectIds.has(options.projectId)) return undefined;
    const message = load(options.projectId).find(
      (candidate) => candidate.id === options.messageId,
    );
    if (message === undefined)
      throw new Error(`Unknown chat message: ${options.messageId}`);
    return message;
  }

  function setBlock(input: {
    projectId: string;
    messageId: string;
    blockIndex: number;
    block: ChatBlock;
  }) {
    const message = findMessage(input);
    if (message === undefined) return;
    if (input.blockIndex > message.blocks.length)
      throw new Error("Block index is past the end of the message");
    message.blocks[input.blockIndex] = input.block;
    save(input.projectId);
    options.bus.publish({
      kind: "chat.block.set",
      projectId: input.projectId,
      messageId: input.messageId,
      blockIndex: input.blockIndex,
      block: input.block,
    });
  }

  return {
    list: (projectId: string) => load(projectId),
    /** Drop the chat of a removed project; later writes to it do nothing. */
    forgetRemoved(projectId: string) {
      removedProjectIds.add(projectId);
      delete loaded[projectId];
    },
    add(input: { projectId: string; message: ChatMessage }) {
      load(input.projectId).push(input.message);
      save(input.projectId);
      options.bus.publish({
        kind: "chat.message.added",
        projectId: input.projectId,
        message: input.message,
      });
    },
    setBlock,
    /** Append `block` to the message and return its index. */
    appendBlock(input: {
      projectId: string;
      messageId: string;
      block: ChatBlock;
    }) {
      const blockIndex = findMessage(input)?.blocks.length ?? 0;
      setBlock({
        projectId: input.projectId,
        messageId: input.messageId,
        blockIndex,
        block: input.block,
      });
      return blockIndex;
    },
    /** Append `text` to the message's last block when it is `text`; otherwise start a new `text` block. */
    appendText(input: { projectId: string; messageId: string; text: string }) {
      const message = findMessage(input);
      if (message === undefined) return;
      const last = message.blocks.at(-1);
      if (last?.kind !== "text") {
        setBlock({
          projectId: input.projectId,
          messageId: input.messageId,
          blockIndex: message.blocks.length,
          block: { kind: "text", markdown: input.text },
        });
        return;
      }
      const text = last.markdown ? `\n\n${input.text}` : input.text;
      last.markdown += text;
      save(input.projectId);
      options.bus.publish({
        kind: "chat.text.appended",
        projectId: input.projectId,
        messageId: input.messageId,
        blockIndex: message.blocks.length - 1,
        text,
      });
    },
    finish(input: {
      projectId: string;
      messageId: string;
      status: "done" | "failed" | "stopped";
    }) {
      const message = findMessage(input);
      if (message === undefined) return;
      message.status = input.status;
      save(input.projectId);
      options.bus.publish({
        kind: "chat.message.finished",
        projectId: input.projectId,
        messageId: input.messageId,
        status: input.status,
      });
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
