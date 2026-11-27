import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";
import { stopAlternativeWorkers } from "../../packages/daemon/src/generation/stop-alternative-workers.ts";
import { readModelRegistry } from "../../packages/daemon/src/preflight/read-model-registry.ts";
import { stopOrphanWorker } from "../../packages/daemon/src/python/stop-orphan-worker.ts";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";

export async function createReconFixture(
  options: { real?: boolean; env?: NodeJS.ProcessEnv; keep?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "planner-b6-"));
  const children: ChildProcess[] = [];
  const sockets: WebSocket[] = [];
  async function freePort() {
    const server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return address.port;
  }
  const env: NodeJS.ProcessEnv = {
    ...(options.real ? process.env : {}),
    PATH: process.env.PATH,
    HOME: join(root, "user-home"),
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
    PLANNER_PORT: String(await freePort()),
    PLANNER_WEB_PORT: String(await freePort()),
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
    PLANNER_PYTHON_BIN: resolve("scripts/b6/fake-python.mjs"),
    B6_CONTROL: join(root, "control.json"),
    B6_CALLS: join(root, "calls.jsonl"),
    ...options.env,
  };
  const origin = `http://localhost:${env.PLANNER_WEB_PORT}`;
  env.PLANNER_WEB_ORIGIN = origin;
  mkdirSync(join(root, "user-home"));
  writeJson({ path: join(root, "control.json"), value: { mode: "normal" } });
  if (!options.real) {
    const registry = readModelRegistry(undefined);
    registry.models = registry.models.map((model) => ({
      ...model,
      files: [{ path: "fixture.safetensors", sizeBytes: 4 }],
    }));
    env.PLANNER_MODEL_REGISTRY = join(root, "registry.json");
    writeJson({ path: env.PLANNER_MODEL_REGISTRY, value: registry });
    for (const model of registry.models) {
      const folder = join(root, "home", "python", "weights", model.folder);
      mkdirSync(folder, {
        recursive: true,
      });
      writeFileSync(join(folder, "fixture.safetensors"), "data");
    }
  }
  async function start() {
    const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      output += error.message;
    });
    const path = join(root, "home", "daemon.json");
    const deadline = Date.now() + 15_000;
    while (
      !existsSync(path) ||
      z
        .object({ pid: z.number() })
        .parse(JSON.parse(readFileSync(path, "utf8"))).pid !== child.pid
    ) {
      assert.equal(child.exitCode, null, output);
      if (Date.now() > deadline)
        throw new Error(`Daemon did not start: ${output}`);
      await delay(20);
    }
    const socket = new WebSocket(`ws://127.0.0.1:${env.PLANNER_PORT}/ws`, {
      headers: { origin },
    });
    sockets.push(socket);
    const frames: z.infer<typeof ServerMessageSchema>[] = [];
    socket.on("message", (data) =>
      frames.push(ServerMessageSchema.parse(JSON.parse(data.toString()))),
    );
    await once(socket, "open");
    async function waitFor<T>(input: {
      read: () => T | undefined;
      label: string;
      timeoutMs?: number;
    }) {
      const deadline = Date.now() + (input.timeoutMs ?? 10_000);
      while (Date.now() < deadline) {
        const result = input.read();
        if (result !== undefined) return result;
        await delay(20);
      }
      throw new Error(`Timed out: ${input.label}; ${output}`);
    }
    async function command(request: { type: string; [key: string]: unknown }) {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ ...request, requestId }));
      const ack = CommandAckSchema.parse(
        await waitFor({
          label: request.type,
          read: () =>
            frames.find(
              (frame) =>
                frame.type === "command.ack" && frame.requestId === requestId,
            ),
        }),
      );
      assert.ok(ack.ok, ack.ok ? "" : ack.error);
      return ack.result;
    }
    await waitFor({
      label: "snapshot",
      read: () => frames.find((frame) => frame.type === "snapshot"),
    });
    return {
      child,
      frames,
      command,
      waitFor,
      socket,
      async stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
        socket.terminate();
        const exited = once(child, "exit");
        child.kill(signal);
        await exited;
      },
    };
  }
  return {
    root,
    env,
    origin,
    start,
    control(value: unknown) {
      writeJson({ path: join(root, "control.json"), value });
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await stopOrphanWorker(join(root, "home", "python-worker.json"));
      await stopOrphanWorker(join(root, "home", "generation-worker.json"));
      await stopAlternativeWorkers(join(root, "home"));
      await stopOrphanWorker(join(root, "home", "surface-worker.json"));
      if (!options.keep) rmSync(root, { recursive: true, force: true });
    },
  };
}
