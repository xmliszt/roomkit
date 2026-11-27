import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { WebSocket } from "ws";
import { createDaemon } from "../create-daemon.ts";

const dns = "roomkit.example.ts.net";
const host = `${dns}:42142`;
const origin = `https://${host}`;
const localOrigin = "http://127.0.0.1:42140";
const owner = "owner@example.test";
const guest = "guest@example.test";
const other = `${dns}:8443`;

type ServeConfig = {
  TCP: { [port: string]: { HTTPS: true } };
  Web: { [host: string]: { Handlers: { [mount: string]: { Proxy: string } } } };
  AllowFunnel: { [host: string]: boolean };
};

function createServeConfig(): ServeConfig {
  return {
    TCP: { "8443": { HTTPS: true } },
    Web: {
      [other]: {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:3210" },
          "/daemon": { Proxy: "http://127.0.0.1:4820" },
        },
      },
    },
    AllowFunnel: {},
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "roomkit-desktop-tailnet-"));
  const file = join(root, "tailscale.json");
  const executable = join(root, "tailscale");
  const data: {
    node: {
      BackendState: string;
      Self: { DNSName: string; UserID: number };
      CurrentTailnet: { MagicDNSEnabled: boolean };
      CertDomains: string[] | null;
      User: { [id: string]: { LoginName: string } };
    };
    serve: ServeConfig;
    fail: string;
    calls: string[][];
  } = {
    node: {
      BackendState: "Running",
      Self: { DNSName: `${dns}.`, UserID: 24 },
      CurrentTailnet: { MagicDNSEnabled: true },
      CertDomains: [dns],
      User: { "24": { LoginName: owner } },
    },
    serve: createServeConfig(),
    fail: "",
    calls: [],
  };
  await writeFile(
    executable,
    `#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const file = process.env.TAILSCALE_TEST_FILE;
const data = JSON.parse(readFileSync(file, "utf8"));
const finish = () => writeFileSync(file, JSON.stringify(data));
if (process.env.TAILSCALE_BE_CLI !== "1") process.exit(2);
if (args.join(" ") === "status --json --peers=false") {
  process.stdout.write(JSON.stringify(data.node));
} else if (args.join(" ") === "serve status --json") {
  process.stdout.write(JSON.stringify(data.serve));
} else {
  if (args.slice(0,4).join(" ") !== "serve --bg --yes --https=42142") process.exit(2);
  const mount = args[4]?.slice("--set-path=".length);
  const target = args[5];
  if (mount !== "/" && mount !== "/daemon") process.exit(2);
  data.calls.push(args);
  if (data.fail === mount) { finish(); process.exit(1); }
  const host = data.node.Self.DNSName.slice(0,-1) + ":42142";
  const handlers = (data.serve.Web[host] ??= { Handlers: {} }).Handlers;
  if (target === "off") {
    delete handlers[mount];
    if (Object.keys(handlers).length === 0) {
      delete data.serve.Web[host];
      delete data.serve.TCP["42142"];
    }
  } else {
    data.serve.TCP["42142"] = { HTTPS: true };
    handlers[mount] = { Proxy: target };
  }
  finish();
}
`,
    { mode: 0o700 },
  );
  async function read() {
    const value: typeof data = JSON.parse(await readFile(file, "utf8"));
    return value;
  }
  async function write(value: typeof data) {
    await writeFile(file, JSON.stringify(value));
  }
  await write(data);
  return {
    createDaemon() {
      return createDaemon({
        env: {
          PLANNER_HOME: join(root, "home"),
          PLANNER_PROJECTS: join(root, "projects"),
          PLANNER_PORT: "0",
          PLANNER_WEB_ORIGIN: localOrigin,
          TAILSCALE_TEST_FILE: file,
        },
        desktopTailnet: { webPort: 42140, servePort: 42142, executable },
      });
    },
    read,
    write,
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

type Browser = { socket: WebSocket; snapshot: Promise<unknown> };

function openBrowser(options: { port: number; login?: string }): Browser {
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}/ws`, {
    origin: options.login ? origin : localOrigin,
    ...(options.login && {
      headers: {
        host,
        "x-forwarded-host": host,
        "tailscale-user-login": options.login,
      },
    }),
  });
  const snapshot = new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("unexpected-response", (_, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("error", reject);
  });
  return { socket, snapshot };
}

async function command(
  browser: Browser,
  message: { type: string; logins?: string[] },
) {
  const requestId = crypto.randomUUID();
  await browser.snapshot;
  return new Promise((resolve, reject) => {
    function onMessage(frame: Buffer) {
      const ack = JSON.parse(frame.toString());
      if (ack.type !== "command.ack" || ack.requestId !== requestId) return;
      browser.socket.off("message", onMessage);
      browser.socket.off("close", reject);
      resolve(ack);
    }
    browser.socket.on("message", onMessage);
    browser.socket.once("close", reject);
    browser.socket.send(JSON.stringify({ ...message, requestId }));
  });
}

async function health(options: {
  port: number;
  login: string;
  origin?: string;
}) {
  return new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: "/health",
        headers: {
          host,
          "tailscale-user-login": options.login,
          "sec-fetch-site": "same-origin",
          ...(options.origin && { origin: options.origin }),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.once("error", reject);
    req.end();
  });
}

test("desktop Tailnet settings persist and revoke remote access without changing other routes", async () => {
  const testFixture = await fixture();
  let daemon = testFixture.createDaemon();
  try {
    const { port, address } = await daemon.listen();
    expect(address).toBe("127.0.0.1");
    let local = openBrowser({ port });
    const initial = await testFixture.read();
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      ok: true,
      result: {
        kind: "desktop",
        state: "disabled",
        logins: [owner],
        canDisable: false,
      },
    });
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner, guest] }),
    ).toMatchObject({
      ok: true,
      result: { state: "ready", url: origin, logins: [owner, guest] },
    });
    const enabled = await testFixture.read();
    expect(enabled.serve.Web[host]?.Handlers).toEqual({
      "/": { Proxy: "http://127.0.0.1:42140" },
      "/daemon": { Proxy: "http://127.0.0.1:0" },
    });
    expect(enabled.serve.Web[other]).toEqual(initial.serve.Web[other]);
    expect(await health({ port, login: owner })).toBe(200);
    expect(
      await health({
        port,
        login: owner,
        origin: "https://another.example.test",
      }),
    ).toBe(403);
    expect(await health({ port, login: "uninvited@example.test" })).toBe(403);
    expect(
      await openBrowser({ port, login: "uninvited@example.test" }).snapshot,
    ).toBe(403);
    const remoteGuest = openBrowser({ port, login: guest });
    expect(await remoteGuest.snapshot).toMatchObject({ type: "snapshot" });
    expect(
      await command(remoteGuest, { type: "tailnet.status" }),
    ).toMatchObject({ ok: true, result: { kind: "desktop-remote" } });
    for (const request of [
      { type: "language.get" },
      { type: "language.set", locale: "fr" },
    ]) {
      expect(await command(remoteGuest, request)).toMatchObject({
        ok: false,
        error: "Only a local browser may access the app language",
      });
    }
    expect(await command(local, { type: "language.get" })).toMatchObject({
      ok: true,
      result: { kind: "pending" },
    });
    const remoteMessages: unknown[] = [];
    remoteGuest.socket.on("message", (data) =>
      remoteMessages.push(JSON.parse(data.toString())),
    );
    const chooseFrench = {
      type: "language.set",
      locale: "fr",
      firstLaunch: true,
    };
    expect(await command(local, chooseFrench)).toMatchObject({
      ok: true,
      result: { kind: "selected", locale: "fr" },
    });
    expect(
      await command(remoteGuest, { type: "tailnet.disable" }),
    ).toMatchObject({ ok: false });
    expect(remoteMessages).not.toContainEqual({
      type: "language.changed",
      locale: "fr",
    });
    expect(
      await command(remoteGuest, { type: "tailnet.enable", logins: [guest] }),
    ).toMatchObject({ ok: false });
    const removed = once(remoteGuest.socket, "close");
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner] }),
    ).toMatchObject({ ok: true, result: { state: "ready", logins: [owner] } });
    await removed;
    expect(await openBrowser({ port, login: guest }).snapshot).toBe(403);
    expect((await testFixture.read()).calls).toHaveLength(2);
    await daemon.close();
    daemon = testFixture.createDaemon();
    const restarted = await daemon.listen();
    local = openBrowser({ port: restarted.port });
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      ok: true,
      result: { state: "ready", url: origin, logins: [owner] },
    });
    const remoteOwner = openBrowser({ port: restarted.port, login: owner });
    expect(await remoteOwner.snapshot).toMatchObject({ type: "snapshot" });
    const disconnected = once(remoteOwner.socket, "close");
    expect(await command(local, { type: "tailnet.disable" })).toMatchObject({
      ok: true,
      result: { state: "disabled", logins: [owner], canDisable: false },
    });
    await disconnected;
    expect(await health({ port: restarted.port, login: owner })).toBe(403);
    expect((await testFixture.read()).serve).toEqual(initial.serve);
    await daemon.close();
    daemon = testFixture.createDaemon();
    const disabled = await daemon.listen();
    expect(
      await command(openBrowser({ port: disabled.port }), {
        type: "tailnet.status",
      }),
    ).toMatchObject({
      ok: true,
      result: { state: "disabled", logins: [owner] },
    });
    expect(
      await openBrowser({ port: disabled.port, login: owner }).snapshot,
    ).toBe(403);
  } finally {
    await daemon.close();
    await testFixture.close();
  }
});

test("desktop setup reports prerequisites and conflicts, and removes only matching targets after failure", async () => {
  const testFixture = await fixture();
  const daemon = testFixture.createDaemon();
  try {
    const { port } = await daemon.listen();
    const local = openBrowser({ port });
    const initial = await testFixture.read();
    const data = await testFixture.read();
    data.node.BackendState = "NeedsLogin";
    await testFixture.write(data);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "disconnected" },
    });
    data.node.BackendState = "Running";
    data.node.CurrentTailnet.MagicDNSEnabled = false;
    await testFixture.write(data);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "needs-dns" },
    });
    data.node.CurrentTailnet.MagicDNSEnabled = true;
    data.node.CertDomains = null;
    await testFixture.write(data);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "needs-https" },
    });
    data.node.CertDomains = [dns];
    data.serve.AllowFunnel[host] = true;
    await testFixture.write(data);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "conflict" },
    });
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner] }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("42142") });
    expect(await testFixture.read()).toEqual(data);
    delete data.serve.AllowFunnel[host];
    const projectsRoute = { Proxy: "http://127.0.0.1:4000" };
    data.serve.TCP["42142"] = { HTTPS: true };
    data.serve.Web[host] = { Handlers: { "/projects/": projectsRoute } };
    await testFixture.write(data);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "conflict", canDisable: false },
    });
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner] }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("42142") });
    expect(await testFixture.read()).toEqual(data);
    delete data.serve.Web[host];
    delete data.serve.TCP["42142"];
    data.fail = "/";
    await testFixture.write(data);
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner] }),
    ).toMatchObject({ ok: false });
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "cleanup-pending", canDisable: true },
    });
    expect(await openBrowser({ port, login: owner }).snapshot).toBe(403);
    const partial = await testFixture.read();
    const rootRoute = { Proxy: "http://127.0.0.1:3123" };
    const handlers = partial.serve.Web[host]?.Handlers;
    if (!handlers) throw new Error("Expected the test Serve configuration");
    Object.assign(handlers, { "/": rootRoute, "/projects/": projectsRoute });
    partial.fail = "";
    await testFixture.write(partial);
    expect(await command(local, { type: "tailnet.disable" })).toMatchObject({
      ok: true,
      result: { state: "conflict", canDisable: false },
    });
    const cleaned = await testFixture.read();
    expect(cleaned.serve.Web[host]?.Handlers).toEqual({
      "/": rootRoute,
      "/projects/": projectsRoute,
    });
    expect(cleaned.serve.Web[other]).toEqual(initial.serve.Web[other]);
  } finally {
    await daemon.close();
    await testFixture.close();
  }
});

test("a failed restore keeps access disabled for the previous and selected logins", async () => {
  const testFixture = await fixture();
  const daemon = testFixture.createDaemon();
  try {
    const { port } = await daemon.listen();
    const local = openBrowser({ port });
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner, guest] }),
    ).toMatchObject({ ok: true });
    const remote = openBrowser({ port, login: guest });
    expect(await remote.snapshot).toMatchObject({ type: "snapshot" });
    const disconnected = once(remote.socket, "close");
    const interrupted = await testFixture.read();
    delete interrupted.serve.TCP["42142"];
    delete interrupted.serve.Web[host];
    interrupted.fail = "/";
    await testFixture.write(interrupted);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "routes-missing" },
    });
    expect(
      await command(local, { type: "tailnet.enable", logins: [owner] }),
    ).toMatchObject({ ok: false });
    await disconnected;
    expect(await health({ port, login: guest })).toBe(403);
    expect(await health({ port, login: owner })).toBe(403);
    expect(await command(local, { type: "tailnet.status" })).toMatchObject({
      result: { state: "cleanup-pending", logins: [owner], canDisable: true },
    });
  } finally {
    await daemon.close();
    await testFixture.close();
  }
});
