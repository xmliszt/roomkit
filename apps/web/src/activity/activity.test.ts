import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { CommandAck } from "@planner/shared/src/protocol/command-ack-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { expect, test } from "vitest";
import { createSnapshotStore } from "../stores/create-snapshot-store.ts";
import { applyActivityMessage } from "./apply-activity-message.ts";
import { createActivityStore } from "./create-activity-store.ts";
import { createChatSync } from "./create-chat-sync.ts";

const projectId = "00000000-0000-4000-8000-000000000001";
const now = () => "2026-11-23T00:00:00.000Z";

function message() {
  return {
    id: "message",
    author: { kind: "agent", role: "designer" },
    blocks: [{ kind: "text", markdown: "Hello" }],
    status: "streaming",
    createdAt: now(),
  } satisfies ChatMessage;
}

function fixture() {
  const activity = createActivityStore();
  activity.setState({
    chats: { [projectId]: { messages: [], isStale: false, version: 0 } },
  });
  function event(event: PlannerEvent) {
    applyActivityMessage({
      store: activity,
      message: { type: "event", event },
      now,
    });
  }
  return {
    activity,
    event,
    history: () => activity.getState().chats[projectId],
  };
}

test("chat applies streamed text, replaces tool blocks and finishes the message", () => {
  const f = fixture();
  f.event({ kind: "chat.message.added", projectId, message: message() });
  f.event({
    kind: "chat.text.appended",
    projectId,
    messageId: "message",
    blockIndex: 0,
    text: " world",
  });
  const tool = {
    kind: "tool",
    toolCallId: "call",
    name: "scene_apply",
    summary: "item.update",
    status: "running",
  } satisfies Extract<PlannerEvent, { kind: "chat.block.set" }>["block"];
  f.event({
    kind: "chat.block.set",
    projectId,
    messageId: "message",
    blockIndex: 1,
    block: tool,
  });
  f.event({
    kind: "chat.block.set",
    projectId,
    messageId: "message",
    blockIndex: 1,
    block: { ...tool, status: "done", durationMs: 400 },
  });
  f.event({
    kind: "chat.message.finished",
    projectId,
    messageId: "message",
    status: "done",
  });
  expect(f.history()?.messages.at(0)).toMatchObject({
    status: "done",
    blocks: [
      { kind: "text", markdown: "Hello world" },
      { ...tool, status: "done", durationMs: 400 },
    ],
  });
  expect(
    f.activity.getState().events.every((line) => line.role === "designer"),
  ).toBe(true);
});

test.each(["unknown-message", "missing-block", "wrong-block-kind"])(
  "%s marks history stale without losing its messages",
  (kind) => {
    const f = fixture();
    f.event({ kind: "chat.message.added", projectId, message: message() });
    if (kind === "wrong-block-kind")
      f.event({
        kind: "chat.block.set",
        projectId,
        messageId: "message",
        blockIndex: 0,
        block: { kind: "job", jobId: "job" },
      });
    const before = f.history()?.messages;
    f.event({
      kind: "chat.text.appended",
      projectId,
      messageId: kind === "unknown-message" ? "missing" : "message",
      blockIndex: kind === "missing-block" ? 4 : 0,
      text: "late",
    });
    expect(f.history()?.isStale).toBe(true);
    expect(f.history()?.messages).toBe(before);
  },
);

test("history retries when events arrive during a read, and reads again after a snapshot", async () => {
  const activity = createActivityStore();
  const snapshot = createSnapshotStore();
  snapshot.setState({ connection: "open" });
  const pending: ((ack: CommandAck) => void)[] = [];
  const sync = createChatSync({
    activity,
    snapshot,
    command: () => new Promise((resolve) => pending.push(resolve)),
  });
  sync.start();
  const unwatch = sync.watch(projectId);
  expect(pending).toHaveLength(1);
  applyActivityMessage({
    store: activity,
    now,
    message: {
      type: "event",
      event: { kind: "chat.message.added", projectId, message: message() },
    },
  });
  pending.at(0)?.({
    type: "command.ack",
    requestId: crypto.randomUUID(),
    ok: true,
    result: { messages: [] },
  });
  await expect.poll(() => pending.length).toBe(2);
  pending.at(1)?.({
    type: "command.ack",
    requestId: crypto.randomUUID(),
    ok: true,
    result: { messages: [message()] },
  });
  await expect
    .poll(() => activity.getState().chats[projectId]?.isStale)
    .toBe(false);
  expect(activity.getState().chats[projectId]?.messages).toEqual([message()]);
  applyActivityMessage({
    store: activity,
    now,
    message: {
      type: "snapshot",
      config: createDefaultConfig(),
      projects: [{ id: projectId, name: "Room" }],
      jobs: [],
      at: now(),
    },
  });
  await expect.poll(() => pending.length).toBe(3);
  pending.at(2)?.({
    type: "command.ack",
    requestId: crypto.randomUUID(),
    ok: true,
    result: { messages: [{ ...message(), status: "stopped" }] },
  });
  await expect
    .poll(() => activity.getState().chats[projectId]?.messages.at(0)?.status)
    .toBe("stopped");
  unwatch();
  sync.stop();
});

test("a failed history read stays retryable without a request loop", async () => {
  const activity = createActivityStore();
  const snapshot = createSnapshotStore();
  snapshot.setState({ connection: "open" });
  const requests: string[] = [];
  const sync = createChatSync({
    activity,
    snapshot,
    command: async (request) => {
      requests.push(request.type);
      return {
        type: "command.ack",
        requestId: crypto.randomUUID(),
        ok: false,
        error: "not available",
      };
    },
  });
  sync.start();
  const unwatch = sync.watch(projectId);
  await expect
    .poll(() => activity.getState().chats[projectId]?.error)
    .toBe("not available");
  expect(requests).toHaveLength(1);
  sync.retry(projectId);
  await expect.poll(() => requests.length).toBe(2);
  unwatch();
  sync.stop();
});

test("job log indexes merge overlapping batches and keep the last 2000 lines", () => {
  const f = fixture();
  f.event({
    kind: "job.log",
    jobId: "constructor",
    firstLineIndex: 0,
    lines: Array.from({ length: 2001 }, (_, index) => `line ${index}`),
  });
  f.event({
    kind: "job.log",
    jobId: "constructor",
    firstLineIndex: 2000,
    lines: ["line 2000", "line 2001"],
  });
  const lines = f.activity.getState().logs.constructor;
  expect(Object.keys(lines ?? {})).toHaveLength(2000);
  expect(lines).toHaveProperty("2001", "line 2001");
  expect(lines).not.toHaveProperty("0");
  expect(f.activity.getState().events.at(-1)?.jobId).toBe("constructor");
});
