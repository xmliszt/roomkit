import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PlannerEventSchema } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "planner-m2-real-claude-"));

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

const port = await freePort();
const webOrigin = `http://localhost:${await freePort()}`;
const daemon = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          key === "CLAUDE_CONFIG_DIR" ||
          !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_EFFORT)/.test(key),
      ),
    ),
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
    PLANNER_PORT: String(port),
    PLANNER_WEB_ORIGIN: webOrigin,
  },
  stdio: ["ignore", "inherit", "inherit"],
});

async function run() {
  for (
    let attempt = 0;
    attempt < 100 && !existsSync(join(root, "home", "daemon.json"));
    attempt++
  )
    await delay(50);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: webOrigin },
  });
  const frames: unknown[] = [];
  socket.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    frames.push(frame);
    const event = z
      .object({ type: z.literal("event"), event: PlannerEventSchema })
      .safeParse(frame);
    if (event.success && event.data.event.kind.startsWith("chat."))
      process.stdout.write(`${JSON.stringify(event.data.event)}\n`);
  });
  await once(socket, "open");
  async function waitFor(options: {
    matches: (frame: unknown) => boolean;
    timeoutMs: number;
  }) {
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const frame = frames.find(options.matches);
      if (frame !== undefined) return frame;
      await delay(50);
    }
    throw new Error("Timed out");
  }
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    const ack = CommandAckSchema.parse(
      await waitFor({
        matches: (frame) =>
          CommandAckSchema.safeParse(frame).data?.requestId === requestId,
        timeoutMs: 60_000,
      }),
    );
    assert.ok(ack.ok, `${request.type} failed: ${ack.ok ? "" : ack.error}`);
    return ack.result;
  }

  const agents = await command({ type: "agents.check" });
  process.stdout.write(`agents.check: ${JSON.stringify(agents, null, 2)}\n`);
  const project = ProjectSchema.parse(
    await command({
      type: "project.create",
      name: "M2 real claude",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  await command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "port",
        name: CHARGING_PORT.name,
        model: { kind: "asset", assetId: CHARGING_PORT.assetId },
        placement: {
          kind: "wall",
          wallId: "wall-2",
          alongM: 1.2,
          heightM: CHARGING_PORT.defaultHeightM,
          rotationRad: 0,
        },
        sizeM: CHARGING_PORT.sizeM,
        locked: false,
      },
    },
  });
  const { agentMessageId } = ChatSendResultSchema.parse(
    await command({
      type: "chat.send",
      projectId: project.id,
      text: "move the charging port 0.5 m left",
    }),
  );
  const finished = z
    .object({
      event: z.object({
        kind: z.literal("chat.message.finished"),
        messageId: z.literal(agentMessageId),
        status: z.string(),
      }),
    })
    .parse(
      await waitFor({
        matches: (frame) =>
          z
            .object({
              event: z.object({
                kind: z.literal("chat.message.finished"),
                messageId: z.literal(agentMessageId),
              }),
            })
            .safeParse(frame).success,
        timeoutMs: 15 * 60_000,
      }),
    );
  assert.equal(finished.event.status, "done", "the turn did not finish done");
  const scene = ProjectSchema.parse(
    await command({ type: "project.open", projectId: project.id }),
  ).scene;
  const moved = scene.items.find((item) => item.id === "port");
  assert.ok(moved?.placement.kind === "wall", "the charging port is gone");
  process.stdout.write(`alongM after the turn: ${moved.placement.alongM}\n`);
  assert.ok(
    Math.abs(moved.placement.alongM - 1.7) < 1e-9,
    "the charging port did not move 0.5 m left (alongM 1.2 → 1.7)",
  );
  const history = ChatHistoryResultSchema.parse(
    await command({ type: "chat.history", projectId: project.id }),
  );
  const diff = history.messages
    .flatMap((message) => message.blocks)
    .find((block) => block.kind === "diff");
  assert.ok(diff?.kind === "diff", "no diff block in the reply");
  for (const undo of diff.undo)
    await command({
      type: "scene.apply",
      projectId: project.id,
      command: undo,
    });
  const restored = ProjectSchema.parse(
    await command({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === "port");
  assert.ok(
    restored?.placement.kind === "wall" && restored.placement.alongM === 1.2,
    "undo did not restore alongM 1.2",
  );
  socket.close();
}

try {
  await run();
  process.stdout.write(
    "m2 real claude passed: the designer moved the charging port through scene_apply and undo restored it\n",
  );
} catch (error) {
  process.stderr.write(
    `m2 real claude failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  if (daemon.exitCode === null) {
    daemon.kill("SIGTERM");
    await once(daemon, "exit");
  }
  rmSync(root, { recursive: true, force: true });
}
