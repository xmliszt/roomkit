import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import { z } from "zod";
import { createDaemon } from "./create-daemon.ts";

export const TEST_WEB_ORIGIN = `http://localhost:${process.env.PLANNER_WEB_PORT ?? "3210"}`;

export async function createTestFixture(
  options: {
    writeDelayMs?: number;
    env?: (root: string) => { [name: string]: string };
  } = {},
) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/daemon-core-"));
  const env = {
    PATH: process.env.PATH,
    HOME: `${root}/user-home`,
    PLANNER_HOME: `${root}/planner`,
    PLANNER_PROJECTS: `${root}/projects`,
    PLANNER_PORT: "0",
    PLANNER_WEB_ORIGIN: TEST_WEB_ORIGIN,
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
    CLAUDE_CONFIG_DIR: `${root}/claude-config`,
    CODEX_HOME: `${root}/codex-home`,
    PLANNER_BREW_BIN: resolve("test/fake-tools/brew"),
    PLANNER_UV_BIN: `${root}/tools/uv`,
    BLENDER: `${root}/tools/blender`,
    FAKE_TOOLS_BIN: `${root}/tools`,
    PLANNER_WEIGHTS_BASE_URL: "http://127.0.0.1:9",
    ...options.env?.(root),
  };
  mkdirSync(env.HOME, { recursive: true });
  const daemon = createDaemon({
    env,
    ...(options.writeDelayMs === undefined
      ? {}
      : { writeDelayMs: options.writeDelayMs }),
  });
  const address = await daemon.listen();
  const sockets: WebSocket[] = [];
  async function connect(headers: { [key: string]: string } = {}) {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
      headers,
    });
    sockets.push(socket);
    const messages: unknown[] = [];
    const received: unknown[] = [];
    const waiters: {
      test: (value: unknown) => boolean;
      resolve: (value: unknown) => void;
    }[] = [];
    socket.on("message", (data) => {
      const value: unknown = JSON.parse(data.toString());
      received.push(value);
      const index = waiters.findIndex((waiter) => waiter.test(value));
      const waiter = waiters.at(index);
      if (index >= 0 && waiter) {
        waiters.splice(index, 1);
        waiter.resolve(value);
      } else messages.push(value);
    });
    function waitForFrame(input: {
      predicate: (value: unknown) => boolean;
      timeoutMs: number;
    }) {
      const predicate = input.predicate;
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1).at(0));
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for WS frame")),
          input.timeoutMs,
        );
        waiters.push({
          test: predicate,
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    }
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return {
      socket,
      received,
      next(predicate: (value: unknown) => boolean) {
        return waitForFrame({ predicate, timeoutMs: 10000 });
      },
      frame(type: string) {
        return waitForFrame({
          predicate: (value) =>
            z.object({ type: z.literal(type) }).safeParse(value).success,
          timeoutMs: 10000,
        });
      },
      async command(command: { type: string; [key: string]: unknown }) {
        const requestId = crypto.randomUUID();
        socket.send(JSON.stringify({ ...command, requestId }));
        return waitForFrame({
          predicate: (value) =>
            z
              .object({
                type: z.literal("command.ack"),
                requestId: z.literal(requestId),
              })
              .safeParse(value).success,
          timeoutMs: 10000,
        });
      },
    };
  }
  return {
    root,
    env,
    daemon,
    address,
    connect,
    connectBrowser: () => connect({ origin: TEST_WEB_ORIGIN }),
    async close() {
      for (const socket of sockets) socket.terminate();
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
