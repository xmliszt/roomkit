import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_CHARS = 8000;

export function buildNewSessionPrompt(options: {
  history: ChatMessage[];
  text: string;
}) {
  const lines = options.history
    .filter((message) => message.status !== "streaming")
    .slice(-MAX_MESSAGES)
    .map((message) => {
      const text = message.blocks
        .flatMap((block) => {
          if (block.kind === "text") return [block.markdown];
          if (block.kind === "item")
            return [JSON.stringify({ itemId: block.itemId, name: block.name })];
          return [];
        })
        .join("\n")
        .trim();
      const clipped =
        text.length > MAX_MESSAGE_CHARS
          ? `${text.slice(0, MAX_MESSAGE_CHARS)} …`
          : text;
      return clipped === ""
        ? undefined
        : `${message.author.kind === "user" ? "User" : "Designer"}: ${clipped}`;
    })
    .filter((line) => line !== undefined);
  const kept = lines
    .toReversed()
    .filter(
      (_, index, newestFirst) =>
        newestFirst
          .slice(0, index + 1)
          .reduce((size, line) => size + line.length, 0) <= MAX_HISTORY_CHARS,
    )
    .toReversed();
  if (kept.length === 0) return undefined;
  return [
    "This is a new session. The recent conversation in this project was:",
    "",
    ...kept,
    "",
    "The user's new message:",
    options.text,
  ].join("\n");
}
