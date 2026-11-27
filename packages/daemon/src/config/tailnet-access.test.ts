import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { type IncomingHttpHeaders, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { WebSocket } from "ws";
import { createDaemon } from "../create-daemon.ts";

test("requires a listed tailnet login and the page origin or same-origin fetch site on HTTP and WebSocket", async () => {
  const root = await mkdtemp(join(tmpdir(), "planner-tailnet-"));
  const host = "roomkit-host.example-tailnet.ts.net:8443";
  const origin = `https://${host}`;
  const login = "planner@example.com";
  const daemon = createDaemon({
    env: {
      PLANNER_HOME: join(root, "home"),
      PLANNER_PROJECTS: join(root, "projects"),
      PLANNER_PORT: "0",
      PLANNER_ALLOWED_HOSTS: ` ${host}, other.tailnet.test:8443 `,
      PLANNER_TAILNET_LOGINS: ` ${login}, other@example.test `,
      PLANNER_WEB_ORIGIN: `http://localhost:3210,${origin}`,
    },
  });
  const sockets: WebSocket[] = [];
  try {
    const address = await daemon.listen();
    expect(address.address).toBe("127.0.0.1");
    const trusted = { host, "tailscale-user-login": login };
    const cases: { headers: IncomingHttpHeaders; status: number }[] = [
      { headers: { ...trusted, origin }, status: 200 },
      { headers: { ...trusted, "sec-fetch-site": "same-origin" }, status: 200 },
      {
        headers: {
          ...trusted,
          origin,
          "tailscale-user-login": "other@example.test",
        },
        status: 200,
      },
      { headers: { host, origin }, status: 403 },
      { headers: { host, "sec-fetch-site": "same-origin" }, status: 403 },
      {
        headers: {
          ...trusted,
          origin,
          "tailscale-user-login": "wrong@example.test",
        },
        status: 403,
      },
      { headers: { ...trusted, "sec-fetch-site": "cross-site" }, status: 403 },
      { headers: { ...trusted, "sec-fetch-site": "same-site" }, status: 403 },
      { headers: { ...trusted }, status: 403 },
      {
        headers: {
          ...trusted,
          origin: "https://foreign.test",
          "sec-fetch-site": "cross-site",
        },
        status: 403,
      },
      { headers: { ...trusted, origin: "http://localhost:3210" }, status: 403 },
      {
        headers: { ...trusted, host: "foreign.test:8443", origin },
        status: 403,
      },
      {
        headers: { ...trusted, host: `${host}.foreign.test`, origin },
        status: 403,
      },
      {
        headers: { ...trusted, host: "other.tailnet.test:8443", origin },
        status: 403,
      },
      {
        headers: { host, authorization: `Bearer ${daemon.auth.internalToken}` },
        status: 403,
      },
    ];
    for (const entry of cases) {
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = request(
            {
              hostname: address.address,
              port: address.port,
              path: "/catalog/charging-port/thumb.png",
              headers: entry.headers,
            },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      expect(status, JSON.stringify(entry.headers)).toBe(entry.status);
      const frame = await new Promise<unknown>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
          headers: entry.headers,
        });
        sockets.push(socket);
        socket.on("message", (data) => resolve(JSON.parse(data.toString())));
        socket.on("unexpected-response", (_, response) => {
          response.resume();
          resolve(response.statusCode);
        });
        socket.on("error", reject);
      });
      if (entry.status === 200) {
        expect(frame).toMatchObject({ type: "snapshot" });
        const socket = sockets.at(-1);
        if (socket === undefined) throw new Error("Missing browser socket");
        const ack = once(socket, "message");
        const requestId = crypto.randomUUID();
        socket.send(
          JSON.stringify({
            type: "agent.scene.apply",
            requestId,
            projectId: crypto.randomUUID(),
            turnId: crypto.randomUUID(),
            command: { type: "room.update", ceilingHeightM: 3 },
          }),
        );
        const [data] = await ack;
        expect(JSON.parse(data.toString())).toMatchObject({
          type: "command.ack",
          requestId,
          ok: false,
          error: "Only an agent connection may send this command",
        });
      } else expect(frame).toBe(403);
    }
    for (const loopback of [
      `127.0.0.1:${address.port}`,
      `localhost:${address.port}`,
      `[::1]:${address.port}`,
    ]) {
      for (const login of [
        "planner@example.com",
        "wrong@example.test",
        undefined,
      ]) {
        const headers: { [name: string]: string } = {
          host: loopback,
          origin,
          "x-forwarded-host": loopback,
          "sec-fetch-site": "same-origin",
        };
        if (login !== undefined) headers["tailscale-user-login"] = login;
        const response = await fetch(
          `http://127.0.0.1:${address.port}/catalog/charging-port/thumb.png`,
          { headers },
        );
        expect(response.status).toBe(403);
        await response.arrayBuffer();
        const refused = await new Promise<number | undefined>(
          (resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
              headers,
            });
            sockets.push(socket);
            socket.on("open", () =>
              reject(new Error("Forwarded loopback Host was accepted")),
            );
            socket.on("unexpected-response", (_, response) => {
              response.resume();
              resolve(response.statusCode);
            });
            socket.on("error", reject);
          },
        );
        expect(refused).toBe(403);
      }
    }
    const url = `http://127.0.0.1:${address.port}/catalog/charging-port/thumb.png`;
    expect((await fetch(url)).status).toBe(401);
    expect(
      (
        await fetch(url, {
          headers: {
            "sec-fetch-site": "same-origin",
            "tailscale-user-login": login,
          },
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(url, { headers: { origin: "http://localhost:3210" } }))
        .status,
    ).toBe(200);
    expect(
      (
        await fetch(url, {
          headers: { authorization: `Bearer ${daemon.auth.internalToken}` },
        })
      ).status,
    ).toBe(200);
  } finally {
    for (const socket of sockets) socket.terminate();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
});
