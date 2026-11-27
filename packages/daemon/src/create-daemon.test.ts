import { existsSync, readFileSync, statSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import { expect, test } from "vitest";
import { WebSocket } from "ws";
import { z } from "zod";
import { createDaemon } from "./create-daemon.ts";
import { createTestFixture, TEST_WEB_ORIGIN } from "./create-test-fixture.ts";

const createCommand = {
  type: "project.create",
  name: "Living room",
  room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
};

const CreatedSchema = z.object({ ok: z.literal(true), result: ProjectSchema });

test("refuses a WebSocket from an origin that is not the web app", async () => {
  const fixture = await createTestFixture();
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${fixture.address.port}/ws`,
        { headers: { origin: "https://untrusted.example.test" } },
      );
      socket.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode),
      );
      socket.once("open", () => reject(new Error("Socket opened")));
      socket.once("error", reject);
    });
    expect(status).toBe(403);
  } finally {
    await fixture.close();
  }
});

test("a socket with no origin must send the token before any command", async () => {
  const fixture = await createTestFixture();
  try {
    const client = await fixture.connect();
    expect(await client.command(createCommand)).toMatchObject({
      ok: false,
      error: "Send the internal token before any command",
    });
    client.socket.send(JSON.stringify({ type: "auth", token: "wrong" }));
    await client.frame("auth.error");
    expect(await client.command(createCommand)).toMatchObject({ ok: false });
    client.socket.send(
      JSON.stringify({
        type: "auth",
        token: fixture.daemon.auth.internalToken,
      }),
    );
    await client.frame("auth.ok");
    expect(
      SnapshotMessageSchema.parse(await client.frame("snapshot")),
    ).toMatchObject({ projects: [], jobs: [], config: { version: 1 } });
    expect(await client.command(createCommand)).toMatchObject({ ok: true });
  } finally {
    await fixture.close();
  }
});

test("local browsers share language changes and a second first-launch choice keeps the first selection", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const secondBrowser = await fixture.connectBrowser();
    for (const local of [browser, secondBrowser]) {
      expect(await local.command({ type: "language.get" })).toMatchObject({
        ok: true,
        result: { kind: "pending" },
      });
    }
    expect(
      await browser.command({ type: "language.set", locale: "unsupported" }),
    ).toMatchObject({ ok: false, error: "Invalid command" });

    const agent = await fixture.connectBrowser();
    agent.socket.send(
      JSON.stringify({
        type: "auth",
        token: fixture.daemon.auth.internalToken,
      }),
    );
    await agent.frame("auth.ok");

    const french = { kind: "selected", locale: "fr" };
    const frenchChange = { type: "language.changed", locale: "fr" };
    const firstAck = await browser.command({
      type: "language.set",
      firstLaunch: true,
      locale: "fr",
    });
    expect(firstAck).toMatchObject({ ok: true, result: french });
    expect(browser.received.slice(-2)).toEqual([frenchChange, firstAck]);
    expect(await browser.frame("language.changed")).toEqual(frenchChange);
    expect(await secondBrowser.frame("language.changed")).toEqual(frenchChange);

    const beforeSecondConfirmation = secondBrowser.received.length;
    const secondAck = await secondBrowser.command({
      type: "language.set",
      firstLaunch: true,
      locale: "de",
    });
    expect(secondAck).toMatchObject({ ok: true, result: french });
    expect(secondBrowser.received.slice(beforeSecondConfirmation)).toEqual([
      secondAck,
    ]);

    const german = { kind: "selected", locale: "de" };
    const germanChange = { type: "language.changed", locale: "de" };
    expect(
      await secondBrowser.command({ type: "language.set", locale: "de" }),
    ).toMatchObject({ ok: true, result: german });
    expect(await browser.frame("language.changed")).toEqual(germanChange);

    for (const command of [
      { type: "language.get" },
      { type: "language.set", locale: "ja" },
    ]) {
      expect(await agent.command(command)).toMatchObject({
        ok: false,
        error: "Only a local browser may access the app language",
      });
    }
    expect(agent.received).not.toContainEqual(frenchChange);
    expect(agent.received).not.toContainEqual(germanChange);

    expect(await browser.command({ type: "language.get" })).toMatchObject({
      ok: true,
      result: german,
    });
  } finally {
    await fixture.close();
  }
});

test("a web app socket creates a project, applies commands, and every socket gets the event", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const watcher = await fixture.connectBrowser();
    const { result: project } = CreatedSchema.parse(
      await browser.command(createCommand),
    );
    expect(await watcher.frame("event")).toMatchObject({
      event: { kind: "project.created", project: { id: project.id } },
    });
    const command = {
      type: "surface.update",
      surfaceId: "floor",
      color: "#c8b79a",
    };
    const requestId = "11111111-1111-4111-8111-111111111111";
    browser.socket.send(
      JSON.stringify({
        type: "scene.apply",
        requestId,
        projectId: project.id,
        command,
      }),
    );
    expect(await browser.frame("command.ack")).toMatchObject({
      ok: true,
      requestId,
      result: { revision: 1 },
    });
    expect(await watcher.frame("event")).toStrictEqual({
      type: "event",
      event: {
        kind: "scene.changed",
        projectId: project.id,
        command,
        revision: 1,
        requestId,
      },
    });
    expect(
      await browser.command({ type: "project.open", projectId: project.id }),
    ).toMatchObject({
      ok: true,
      result: {
        revision: 1,
        scene: { room: { surfaces: { floor: { color: "#c8b79a" } } } },
      },
    });
  } finally {
    await fixture.close();
  }
});

test("acks an invalid or rejected command with an error", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const { result: project } = CreatedSchema.parse(
      await browser.command(createCommand),
    );
    expect(
      await browser.command({
        type: "scene.apply",
        projectId: project.id,
        command: { type: "item.move", itemId: "sofa" },
      }),
    ).toMatchObject({ ok: false, error: "Invalid command" });
    expect(
      await browser.command({
        type: "scene.apply",
        projectId: project.id,
        command: { type: "item.remove", itemId: "ghost" },
      }),
    ).toMatchObject({ ok: false, error: "Item ghost does not exist" });
    expect(
      await browser.command({
        type: "project.open",
        projectId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toMatchObject({ ok: false });
  } finally {
    await fixture.close();
  }
});

test("writes daemon.json for local clients and removes it on close; close writes pending changes", async () => {
  const fixture = await createTestFixture({ writeDelayMs: 60000 });
  const daemonFile = join(fixture.env.PLANNER_HOME, "daemon.json");
  let restarted: ReturnType<typeof createDaemon> | undefined;
  try {
    expect(JSON.parse(readFileSync(daemonFile, "utf8"))).toStrictEqual({
      port: fixture.address.port,
      token: fixture.daemon.auth.internalToken,
      pid: process.pid,
    });
    expect(statSync(daemonFile).mode & 0o777).toBe(0o600);
    const project = fixture.daemon.store.createProject({
      name: "Living room",
      room: createCommand.room,
    });
    fixture.daemon.store.applyCommand({
      projectId: project.id,
      command: { type: "room.update", ceilingHeightM: 2.8 },
      requestId: undefined,
    });
    await fixture.daemon.close();
    expect(existsSync(daemonFile)).toBe(false);
    restarted = createDaemon({ env: fixture.env });
    expect(restarted.store.loadProject(project.id)).toMatchObject({
      revision: 1,
      scene: { room: { ceilingHeightM: 2.8 } },
    });
  } finally {
    await restarted?.close();
    await fixture.close();
  }
});

test("answers /health and refuses HTTP from another origin", async () => {
  const fixture = await createTestFixture();
  try {
    const url = `http://127.0.0.1:${fixture.address.port}/health`;
    const allowed = await fetch(url, { headers: { origin: TEST_WEB_ORIGIN } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      TEST_WEB_ORIGIN,
    );
    expect(await allowed.json()).toStrictEqual({ ok: true });
    const refused = await fetch(url, {
      headers: { origin: "https://untrusted.example.test" },
    });
    expect(refused.status).toBe(403);
  } finally {
    await fixture.close();
  }
});

test("a daemon that cannot listen leaves the running daemon's daemon.json in place", async () => {
  const fixture = await createTestFixture();
  const daemonFile = join(fixture.env.PLANNER_HOME, "daemon.json");
  const second = createDaemon({
    env: { ...fixture.env, PLANNER_PORT: String(fixture.address.port) },
  });
  try {
    await expect(second.listen()).rejects.toThrowError(/EADDRINUSE/);
    await second.close();
    expect(JSON.parse(readFileSync(daemonFile, "utf8")).token).toBe(
      fixture.daemon.auth.internalToken,
    );
  } finally {
    await fixture.close();
  }
});

test("refuses HTTP and WebSocket requests whose Host is not this daemon", async () => {
  const fixture = await createTestFixture();
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${fixture.address.port}/ws`,
        { headers: { host: "rebound.example.test" } },
      );
      socket.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode),
      );
      socket.once("open", () => reject(new Error("Socket opened")));
      socket.once("error", reject);
    });
    expect(status).toBe(403);
    const response = await new Promise<number | undefined>((resolve, reject) =>
      get(
        {
          host: "127.0.0.1",
          port: fixture.address.port,
          path: "/health",
          headers: { host: "rebound.example.test" },
        },
        (message) => resolve(message.statusCode),
      ).once("error", reject),
    );
    expect(response).toBe(403);
  } finally {
    await fixture.close();
  }
});

test("close leaves a daemon.json that another daemon has written since", async () => {
  const fixture = await createTestFixture();
  const daemonFile = join(fixture.env.PLANNER_HOME, "daemon.json");
  const second = createDaemon({ env: fixture.env });
  try {
    await second.listen();
    await fixture.daemon.close();
    expect(JSON.parse(readFileSync(daemonFile, "utf8")).token).toBe(
      second.auth.internalToken,
    );
    await second.close();
    expect(existsSync(daemonFile)).toBe(false);
  } finally {
    await second.close();
    await fixture.close();
  }
});

test("a socket with no origin gets no snapshot and no event before auth.ok", async () => {
  const fixture = await createTestFixture();
  try {
    const silent = await fixture.connect();
    const browser = await fixture.connectBrowser();
    await browser.frame("snapshot");
    CreatedSchema.parse(await browser.command(createCommand));
    await browser.frame("event");
    silent.socket.send(
      JSON.stringify({
        type: "auth",
        token: fixture.daemon.auth.internalToken,
      }),
    );
    await silent.frame("snapshot");
    expect(silent.received.slice(0, 2)).toMatchObject([
      { type: "auth.ok" },
      { type: "snapshot", projects: [{ name: "Living room" }] },
    ]);
    expect(silent.received).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

test("project.rename and project.remove ack and reach every socket", async () => {
  const fixture = await createTestFixture();
  try {
    const browser = await fixture.connectBrowser();
    const watcher = await fixture.connectBrowser();
    const { result: project } = CreatedSchema.parse(
      await browser.command(createCommand),
    );
    await watcher.frame("event");
    expect(
      await browser.command({
        type: "project.rename",
        projectId: project.id,
        name: "Den",
      }),
    ).toMatchObject({ ok: true, result: { id: project.id, name: "Den" } });
    expect(await watcher.frame("event")).toStrictEqual({
      type: "event",
      event: {
        kind: "project.renamed",
        project: { id: project.id, name: "Den" },
      },
    });
    expect(
      await browser.command({
        type: "project.rename",
        projectId: project.id,
        name: " ",
      }),
    ).toMatchObject({ ok: false, error: "Invalid command" });
    expect(
      await browser.command({ type: "project.remove", projectId: project.id }),
    ).toMatchObject({ ok: true, result: { projectId: project.id } });
    expect(await watcher.frame("event")).toStrictEqual({
      type: "event",
      event: { kind: "project.removed", projectId: project.id },
    });
    expect(
      await browser.command({ type: "project.open", projectId: project.id }),
    ).toMatchObject({
      ok: false,
      error: `Project ${project.id} does not exist`,
    });
    expect(
      await browser.command({ type: "project.remove", projectId: project.id }),
    ).toMatchObject({ ok: false });
  } finally {
    await fixture.close();
  }
});
