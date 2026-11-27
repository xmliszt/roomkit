import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import { expect, test } from "vitest";
import { buildNewSessionPrompt } from "./build-new-session-prompt.ts";

function buildMessage(options: {
  index: number;
  markdown: string;
  status?: ChatMessage["status"];
}): ChatMessage {
  return {
    id: `m${options.index}`,
    author:
      options.index % 2 === 0
        ? { kind: "user" }
        : { kind: "agent", role: "designer" },
    blocks: [{ kind: "text", markdown: options.markdown }],
    status: options.status ?? "done",
    createdAt: "2026-11-22T10:00:00.000Z",
  };
}

test("returns undefined when there is no history", () => {
  expect(buildNewSessionPrompt({ history: [], text: "hi" })).toBeUndefined();
});

function historyLines(prompt: string | undefined) {
  return (prompt ?? "")
    .split("\n")
    .filter((line) => /^(User|Designer): /.test(line));
}

test("keeps the last 12 messages", () => {
  const history = Array.from({ length: 20 }, (_, index) =>
    buildMessage({ index, markdown: `message ${index}` }),
  );
  const lines = historyLines(buildNewSessionPrompt({ history, text: "next" }));
  expect(lines).toHaveLength(12);
  expect(lines.at(0)).toBe("User: message 8");
  expect(lines.at(-1)).toBe("Designer: message 19");
});

test("clips each message at 2000 characters and the history at 8000, keeping the newest", () => {
  const history = Array.from({ length: 6 }, (_, index) =>
    buildMessage({ index, markdown: `${index}:${"x".repeat(2500)}` }),
  );
  const prompt = buildNewSessionPrompt({ history, text: "next" });
  const lines = historyLines(prompt);
  expect(lines.map((line) => line.length)).toStrictEqual([2012, 2008, 2012]);
  expect(lines.map((line) => /^\w+: \d+/.exec(line)?.at(0))).toStrictEqual([
    "Designer: 3",
    "User: 4",
    "Designer: 5",
  ]);
  expect(prompt?.endsWith("The user's new message:\nnext")).toBe(true);
});

test("leaves out streaming messages and messages with no text", () => {
  expect(
    buildNewSessionPrompt({
      history: [
        buildMessage({ index: 0, markdown: "kept" }),
        buildMessage({ index: 1, markdown: "  " }),
        buildMessage({ index: 2, markdown: "live", status: "streaming" }),
      ],
      text: "next",
    }),
  ).toBe(
    "This is a new session. The recent conversation in this project was:\n\nUser: kept\n\nThe user's new message:\nnext",
  );
});
