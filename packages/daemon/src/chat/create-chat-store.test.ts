import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { expect, test } from "vitest";
import { EventBus } from "../ws/event-bus.ts";
import { createChatStore } from "./create-chat-store.ts";

const projectId = "6fd0b15a-b3a8-4ed7-856c-dba67a740c10";

test("appends text to a text block, starts a new one after other blocks, and stops stale streaming messages on reload", () => {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/chat-store-"));
  try {
    mkdirSync(join(root, ".planner"));
    const bus = new EventBus();
    const events: PlannerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const chat = createChatStore({ bus, projectPath: () => root });
    chat.add({
      projectId,
      message: {
        id: "m1",
        author: { kind: "agent", role: "designer" },
        blocks: [],
        status: "streaming",
        createdAt: new Date(0).toISOString(),
      },
    });
    chat.appendText({ projectId, messageId: "m1", text: "One" });
    chat.appendText({ projectId, messageId: "m1", text: "Two" });
    chat.appendBlock({
      projectId,
      messageId: "m1",
      block: { kind: "job", jobId: "job-1" },
    });
    chat.appendText({ projectId, messageId: "m1", text: "Three" });
    expect(chat.list(projectId).at(0)?.blocks).toStrictEqual([
      { kind: "text", markdown: "One\n\nTwo" },
      { kind: "job", jobId: "job-1" },
      { kind: "text", markdown: "Three" },
    ]);
    expect(events.map((event) => event.kind)).toStrictEqual([
      "chat.message.added",
      "chat.block.set",
      "chat.text.appended",
      "chat.block.set",
      "chat.block.set",
    ]);
    const reloaded = createChatStore({ bus, projectPath: () => root });
    expect(reloaded.list(projectId).at(0)?.status).toBe("stopped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
