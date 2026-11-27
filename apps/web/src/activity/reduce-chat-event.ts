import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import type { ChatHistory } from "./create-activity-store.ts";

export type ChatEvent = Extract<PlannerEvent, { kind: `chat.${string}` }>;

export function reduceChatEvent(options: {
  history: ChatHistory | undefined;
  event: ChatEvent;
}) {
  const { event } = options;
  const history = options.history ?? {
    messages: [],
    isStale: true,
    version: 0,
  };
  const next = { ...history, version: history.version + 1 };
  if (history.isStale) return next;
  if (event.kind === "chat.message.added") {
    return {
      ...next,
      messages: [
        ...history.messages.filter(
          (message) => message.id !== event.message.id,
        ),
        event.message,
      ],
    };
  }
  const message = history.messages.find(
    (entry) => entry.id === event.messageId,
  );
  if (message === undefined) return { ...next, isStale: true };
  const updated = (() => {
    switch (event.kind) {
      case "chat.message.finished":
        return { ...message, status: event.status };
      case "chat.text.appended": {
        const block = message.blocks.at(event.blockIndex);
        if (block?.kind !== "text") return undefined;
        return {
          ...message,
          blocks: message.blocks.map((entry, index) =>
            index === event.blockIndex
              ? { ...block, markdown: block.markdown + event.text }
              : entry,
          ),
        };
      }
      case "chat.block.set":
        if (event.blockIndex > message.blocks.length) return undefined;
        return {
          ...message,
          blocks:
            event.blockIndex === message.blocks.length
              ? [...message.blocks, event.block]
              : message.blocks.map((block, index) =>
                  index === event.blockIndex ? event.block : block,
                ),
        };
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }
  })();
  return updated === undefined
    ? { ...next, isStale: true }
    : {
        ...next,
        messages: history.messages.map((entry) =>
          entry.id === message.id ? updated : entry,
        ),
      };
}
