import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { CommandAck } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { createActivityStore } from "../activity/create-activity-store.ts";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { createDiffUndo } from "./create-diff-undo.ts";

const input = {
  projectId: "project",
  blockKey: '["project","message",0]',
  commands: [
    { type: "item.remove", itemId: "first" },
    { type: "item.remove", itemId: "second" },
  ] satisfies Command[],
};
const ok = {
  type: "command.ack",
  requestId: "test",
  ok: true,
} satisfies CommandAck;

function createRemovalFixture(options: {
  itemIds: string[];
  disconnectAfter?: number;
}) {
  const activity = createActivityStore();
  let scene = {
    ...createRectangularScene({ widthM: 4, depthM: 5, ceilingHeightM: 2.8 }),
    items: options.itemIds.map((id) =>
      buildItem({
        id,
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      }),
    ),
  };
  let connected = true;
  const sent: Command[] = [];
  const dependencies = {
    activity,
    connected: () => connected,
    itemExists: (query: { projectId: string; itemId: string }) =>
      scene.items.some((item) => item.id === query.itemId),
    command: async (request: ClientCommand) => {
      if (request.type !== "scene.apply")
        throw new Error("Expected scene.apply");
      sent.push(request.command);
      const result = applyCommand({ scene, command: request.command });
      if (result.kind === "rejected")
        return { ...ok, ok: false, error: result.reason } satisfies CommandAck;
      scene = result.scene;
      if (sent.length === options.disconnectAfter) connected = false;
      return ok;
    },
  };
  return {
    activity,
    sent,
    undo: createDiffUndo(dependencies),
    remaining: () => scene.items.map((item) => item.id),
    reconnect() {
      connected = true;
    },
  };
}

test("undo skips an already removed item and removes every remaining item", async () => {
  const fixture = createRemovalFixture({ itemIds: ["second"] });
  await fixture.undo(input);
  expect(fixture.remaining()).toEqual([]);
  expect(fixture.sent).toEqual([{ type: "item.remove", itemId: "second" }]);
  expect(fixture.activity.getState().undos[input.blockKey]).toEqual({
    kind: "done",
    completed: 2,
  });
});

test("undo retry keeps its original offset after a skipped removal and disconnect", async () => {
  const fixture = createRemovalFixture({
    itemIds: ["second", "third"],
    disconnectAfter: 1,
  });
  const batch = {
    ...input,
    commands: [
      ...input.commands,
      { type: "item.remove", itemId: "third" } satisfies Command,
    ],
  };
  await fixture.undo(batch);
  expect(fixture.remaining()).toEqual(["third"]);
  expect(fixture.activity.getState().undos[input.blockKey]).toMatchObject({
    kind: "failed",
    completed: 2,
  });
  fixture.reconnect();
  await fixture.undo(batch);
  expect(fixture.remaining()).toEqual([]);
  expect(fixture.sent).toEqual([
    { type: "item.remove", itemId: "second" },
    { type: "item.remove", itemId: "third" },
  ]);
  expect(fixture.activity.getState().undos[input.blockKey]).toEqual({
    kind: "done",
    completed: 3,
  });
});

test("the planner skips absent items only from a current scene without pending edits", async () => {
  const session = createPlannerSession({
    url: "ws://unused",
    createSocket() {
      throw new Error("This test does not connect");
    },
  });
  const project = {
    id: "project",
    name: "Room",
    revision: 0,
    scene: createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.8,
    }),
  };
  session.stores.snapshot.setState({ connection: "open" });
  for (const state of [
    { blockKey: "current", isStale: false, requestIds: [], expected: "done" },
    { blockKey: "stale", isStale: true, requestIds: [], expected: "unknown" },
    {
      blockKey: "pending",
      isStale: false,
      requestIds: ["pending-request"],
      expected: "unknown",
    },
  ]) {
    session.stores.projects.setState({
      opened: { project: { project, isStale: state.isStale } },
      ownRequestIds: { project: state.requestIds },
    });
    await session.undoDiff({ ...input, blockKey: state.blockKey });
    expect(session.stores.activity.getState().undos[state.blockKey]?.kind).toBe(
      state.expected,
    );
  }
  session.stop();
});

test("pending and completed undo survives a new caller without duplicate commands", async () => {
  const activity = createActivityStore();
  const pending = Promise.withResolvers<CommandAck>();
  let calls = 0;
  const options = {
    activity,
    connected: () => true,
    command: async () => {
      calls += 1;
      return pending.promise;
    },
  };
  const first = createDiffUndo(options)(input);
  await createDiffUndo(options)(input);
  expect(calls).toBe(1);
  pending.resolve(ok);
  await first;
  await createDiffUndo(options)(input);
  expect(calls).toBe(2);
  expect(activity.getState().undos[input.blockKey]).toEqual({
    kind: "done",
    completed: 2,
  });
});

test("retry resumes after acknowledged inverses and never repeats them", async () => {
  const activity = createActivityStore();
  let calls = 0;
  const undo = createDiffUndo({
    activity,
    connected: () => true,
    command: async () => {
      calls += 1;
      return calls === 2
        ? {
            type: "command.ack",
            requestId: "test",
            ok: false,
            error: "temporarily unavailable",
          }
        : ok;
    },
  });
  await undo(input);
  expect(activity.getState().undos[input.blockKey]).toMatchObject({
    kind: "failed",
    completed: 1,
  });
  await undo(input);
  expect(calls).toBe(3);
  expect(activity.getState().undos[input.blockKey]).toEqual({
    kind: "done",
    completed: 2,
  });
});

test("lost acknowledgement blocks retries whose result is unknown", async () => {
  const activity = createActivityStore();
  let calls = 0;
  const undo = createDiffUndo({
    activity,
    connected: () => true,
    command: async () => {
      calls += 1;
      throw new Error("disconnected");
    },
  });
  await undo(input);
  await undo(input);
  expect(calls).toBe(1);
  expect(activity.getState().undos[input.blockKey]?.kind).toBe("unknown");
});

test("an offline undo sends nothing and remains retryable after reconnection", async () => {
  const activity = createActivityStore();
  let connected = false;
  let calls = 0;
  const undo = createDiffUndo({
    activity,
    connected: () => connected,
    command: async () => {
      calls += 1;
      return ok;
    },
  });
  await undo(input);
  expect(calls).toBe(0);
  expect(activity.getState().undos[input.blockKey]).toMatchObject({
    kind: "failed",
    completed: 0,
  });
  connected = true;
  await undo(input);
  expect(calls).toBe(2);
  expect(activity.getState().undos[input.blockKey]?.kind).toBe("done");
});
