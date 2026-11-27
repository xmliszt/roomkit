import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { ServerMessage } from "@planner/shared/src/protocol/server-message-schema.ts";
import { expect, test } from "vitest";
import { createJobsStore } from "../../apps/web/src/stores/create-jobs-store.ts";
import { createProjectsStore } from "../../apps/web/src/stores/create-projects-store.ts";
import { createSnapshotStore } from "../../apps/web/src/stores/create-snapshot-store.ts";
import { applyMessage } from "../../apps/web/src/ws/apply-message.ts";
import { createWsClient } from "../../apps/web/src/ws/ws-client.ts";
import { createDaemon } from "../../packages/daemon/src/create-daemon.ts";
import {
  createTestFixture,
  TEST_WEB_ORIGIN,
} from "../../packages/daemon/src/create-test-fixture.ts";

function createBrowserSocket(options: { url: string; origin: string }) {
  // Node's WebSocket takes request headers as a second argument that the DOM type does not declare; a browser sets Origin itself.
  const socket: WebSocket = Reflect.construct(WebSocket, [
    options.url,
    { headers: { origin: options.origin } },
  ]);
  return socket;
}

function createStores() {
  return {
    snapshot: createSnapshotStore(),
    projects: createProjectsStore(),
    jobs: createJobsStore(),
  };
}

test("correlates real daemon acks, applies events, and reconnects with a fresh snapshot", async () => {
  const fixture = await createTestFixture();
  const messages: ServerMessage[] = [];
  const stores = createStores();
  const client = createWsClient({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: (url) =>
      createBrowserSocket({ url, origin: TEST_WEB_ORIGIN }),
    onMessage(message) {
      messages.push(message);
      applyMessage({ stores, message });
    },
    onConnection: (connection) => stores.snapshot.setState({ connection }),
  });
  let restarted: ReturnType<typeof createDaemon> | undefined;
  try {
    client.start();
    await expect
      .poll(
        () => messages.filter((message) => message.type === "snapshot").length,
      )
      .toBe(1);
    const created = await client.command({
      type: "project.create",
      requestId: "11111111-1111-4111-8111-111111111111",
      name: "WS",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    });
    expect(created).toMatchObject({
      ok: true,
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    const project = ProjectSchema.parse(created.ok ? created.result : {});
    await expect
      .poll(() => stores.projects.getState().summaries)
      .toStrictEqual([{ id: project.id, name: "WS" }]);
    stores.projects.setState({
      opened: { [project.id]: { project, isStale: false } },
    });
    expect(
      await client.command({
        type: "scene.apply",
        projectId: project.id,
        command: { type: "item.remove", itemId: "ghost" },
      }),
    ).toMatchObject({ ok: false, error: "Item ghost does not exist" });
    expect(
      await client.command({
        type: "scene.apply",
        projectId: project.id,
        command: { type: "room.update", ceilingHeightM: 2.8 },
      }),
    ).toMatchObject({ ok: true, result: { revision: 1 } });
    await expect
      .poll(() => stores.projects.getState().opened[project.id]?.project)
      .toMatchObject({
        revision: 1,
        scene: { room: { ceilingHeightM: 2.8 } },
      });
    fixture.daemon.bus.publish({
      kind: "job.updated",
      job: {
        id: "job",
        kind: "generation",
        projectId: project.id,
        itemId: "sofa",
        stage: "generating",
        progress: 0.5,
        createdAt: "2026-11-22T10:00:00.000Z",
        updatedAt: "2026-11-22T10:00:01.000Z",
      },
    });
    await expect
      .poll(() => stores.jobs.getState().jobs.job?.stage)
      .toBe("generating");
    await fixture.daemon.close();
    await expect
      .poll(() => stores.snapshot.getState().connection)
      .toBe("closed");
    restarted = createDaemon({
      env: { ...fixture.env, PLANNER_PORT: String(fixture.address.port) },
    });
    await restarted.listen();
    await expect
      .poll(
        () => messages.filter((message) => message.type === "snapshot").length,
        { timeout: 5000 },
      )
      .toBe(2);
    expect(stores.projects.getState().summaries.at(0)?.id).toBe(project.id);
    expect(stores.projects.getState().opened[project.id]?.isStale).toBe(true);
    expect(stores.snapshot.getState().connection).toBe("open");
    expect(
      await client.command({ type: "project.open", projectId: project.id }),
    ).toMatchObject({
      ok: true,
      result: { revision: 1, scene: { room: { ceilingHeightM: 2.8 } } },
    });
  } finally {
    client.stop();
    await restarted?.close();
    await fixture.close();
  }
});

test("a socket from another origin never opens", async () => {
  const fixture = await createTestFixture();
  const connections: string[] = [];
  const client = createWsClient({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: (url) =>
      createBrowserSocket({ url, origin: "https://untrusted.example.test" }),
    onMessage() {},
    onConnection: (connection) => connections.push(connection),
  });
  try {
    client.start();
    await expect.poll(() => connections).toContain("closed");
    expect(connections).not.toContain("open");
  } finally {
    client.stop();
    await fixture.close();
  }
});

test("rejects a command sent while disconnected", async () => {
  const client = createWsClient({
    url: "ws://127.0.0.1:1/ws",
    createSocket: (url) => new WebSocket(url),
    onMessage() {},
    onConnection() {},
  });
  await expect(
    client.command({
      type: "project.open",
      projectId: "00000000-0000-4000-8000-000000000000",
    }),
  ).rejects.toThrowError("WebSocket disconnected");
});
