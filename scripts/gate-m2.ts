import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { AgentsCheckResultSchema } from "@planner/shared/src/protocol/agents-check-result-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import {
  type PlannerEvent,
  PlannerEventSchema,
} from "@planner/shared/src/protocol/planner-event-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "planner-gate-m2-"));
const plannerHome = join(root, "home");
const projectsRoot = join(root, "projects");
const pidPath = join(root, "fake-cli-pids.json");
const children: ChildProcess[] = [];

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

const port = Number(process.env.PLANNER_PORT) || (await freePort());
const webPort = Number(process.env.PLANNER_WEB_PORT) || (await freePort());
const webOrigin = `http://localhost:${webPort}`;

async function startDaemon() {
  for (const folder of ["user-home", "claude-config", "codex-home"])
    mkdirSync(join(root, folder), { recursive: true });
  const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "user-home"),
      CLAUDE_CONFIG_DIR: join(root, "claude-config"),
      CODEX_HOME: join(root, "codex-home"),
      PLANNER_HOME: plannerHome,
      PLANNER_PROJECTS: projectsRoot,
      PLANNER_PORT: String(port),
      PLANNER_WEB_ORIGIN: webOrigin,
      PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
      PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
      PLANNER_FAKE_SCENARIO: "move-charging-port",
      FAKE_CLI_PID_PATH: pidPath,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const daemonFile = join(plannerHome, "daemon.json");
  for (let attempt = 0; attempt < 100 && !existsSync(daemonFile); attempt++) {
    assert.equal(child.exitCode, null, "the daemon exited before it listened");
    await delay(50);
  }
  assert.ok(existsSync(daemonFile), "the daemon did not listen");
  return child;
}

async function connectBrowser() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: webOrigin },
  });
  const unread: unknown[] = [];
  const events: PlannerEvent[] = [];
  socket.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    unread.push(frame);
    const event = z
      .object({ type: z.literal("event"), event: PlannerEventSchema })
      .safeParse(frame);
    if (event.success) events.push(event.data.event);
  });
  await once(socket, "open");
  async function next<T>(options: {
    schema: z.ZodType<T>;
    timeoutMs?: number;
  }) {
    const deadline = Date.now() + (options.timeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      const index = unread.findIndex(
        (frame) => options.schema.safeParse(frame).success,
      );
      if (index >= 0)
        return options.schema.parse(unread.splice(index, 1).at(0));
      await delay(10);
    }
    throw new Error("Timed out waiting for a WebSocket frame");
  }
  async function waitForEvent(options: {
    matches: (event: PlannerEvent) => boolean;
    timeoutMs?: number;
  }) {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      const event = events.find(options.matches);
      if (event) return event;
      await delay(10);
    }
    throw new Error("Timed out waiting for an event");
  }
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    const ack = await next({
      schema: CommandAckSchema.refine((frame) => frame.requestId === requestId),
    });
    assert.ok(ack.ok, `${request.type} failed: ${ack.ok ? "" : ack.error}`);
    return ack.result;
  }
  return { socket, events, next, waitForEvent, command };
}

type Browser = Awaited<ReturnType<typeof connectBrowser>>;

const chargingPort: Item = {
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
};

async function openScene(options: { browser: Browser; projectId: string }) {
  return ProjectSchema.parse(
    await options.browser.command({
      type: "project.open",
      projectId: options.projectId,
    }),
  ).scene;
}

function blocksOf(options: { events: PlannerEvent[]; messageId: string }) {
  return options.events.flatMap((event) =>
    event.kind === "chat.block.set" && event.messageId === options.messageId
      ? [event.block]
      : [],
  );
}

async function moveWith(options: {
  browser: Browser;
  projectId: string;
  cli: "claude" | "codex";
}) {
  const { browser, projectId, cli } = options;
  const snapshot = SnapshotMessageSchema.parse(
    await browser
      .command({
        type: "config.update",
        roles: {
          surveyor: { cli: "claude", model: "claude-sonnet-5-5" },
          modeler: { cli: "claude", model: "claude-opus-5-5" },
          designer: {
            cli,
            model: cli === "claude" ? "claude-sonnet-5-5" : "gpt-5",
          },
        },
      })
      .then(() => browser.next({ schema: SnapshotMessageSchema })),
  );
  assert.equal(
    snapshot.config.roles.designer.cli,
    cli,
    "config.update did not apply",
  );

  const before = await openScene({ browser, projectId });
  const { agentMessageId } = ChatSendResultSchema.parse(
    await browser.command({
      type: "chat.send",
      projectId,
      text: "move the charging port 0.5 m left",
    }),
  );
  const finished = await browser.waitForEvent({
    matches: (event) =>
      event.kind === "chat.message.finished" &&
      event.messageId === agentMessageId,
  });
  const blocks = blocksOf({
    events: browser.events,
    messageId: agentMessageId,
  });
  assert.ok(
    finished.kind === "chat.message.finished" && finished.status === "done",
    `${cli}: the turn did not finish done: ${JSON.stringify(blocks)}`,
  );

  const expected = {
    ...before,
    items: before.items.map((item) =>
      item.id === chargingPort.id && item.placement.kind === "wall"
        ? {
            ...item,
            placement: {
              ...item.placement,
              alongM: item.placement.alongM + 0.5,
            },
          }
        : item,
    ),
  };
  const after = await openScene({ browser, projectId });
  assert.deepEqual(
    after,
    expected,
    `${cli}: the scene did not change by exactly the move`,
  );

  const tool = blocks.findLast(
    (block): block is Extract<ChatBlock, { kind: "tool" }> =>
      block.kind === "tool" && block.name === "scene_apply",
  );
  assert.equal(
    tool?.status,
    "done",
    `${cli}: no finished scene_apply tool block`,
  );
  const diff = blocks.find(
    (block): block is Extract<ChatBlock, { kind: "diff" }> =>
      block.kind === "diff",
  );
  assert.ok(diff, `${cli}: no diff block arrived over WS`);
  assert.ok(
    diff.changes.some(
      (change) => change.before === "1.20 m" && change.after === "1.70 m",
    ),
    `${cli}: the diff block does not show the alongM change: ${JSON.stringify(diff.changes)}`,
  );
  for (const command of diff.undo)
    await browser.command({ type: "scene.apply", projectId, command });
  assert.deepEqual(
    await openScene({ browser, projectId }),
    before,
    `${cli}: the diff block's undo did not restore the scene`,
  );
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killMidTurn(options: { browser: Browser; projectId: string }) {
  const { browser, projectId } = options;
  rmSync(pidPath, { force: true });
  const { agentMessageId } = ChatSendResultSchema.parse(
    await browser.command({
      type: "chat.send",
      projectId,
      text: "[fake:hold-process-group] hold",
    }),
  );
  await browser.waitForEvent({
    matches: (event) =>
      event.kind === "chat.block.set" &&
      event.messageId === agentMessageId &&
      event.block.kind === "text",
  });
  const pids = z
    .object({ cliPid: z.number().int(), childPid: z.number().int() })
    .parse(JSON.parse(readFileSync(pidPath, "utf8")));
  assert.ok(isAlive(pids.childPid), "the turn's child process is not running");
  await browser.command({ type: "chat.stop", projectId });
  const finished = await browser.waitForEvent({
    matches: (event) =>
      event.kind === "chat.message.finished" &&
      event.messageId === agentMessageId,
  });
  assert.ok(
    finished.kind === "chat.message.finished" && finished.status === "stopped",
    "the stopped turn did not finish as stopped",
  );
  assert.ok(!isAlive(pids.cliPid), "the agent CLI survived the stop");
  assert.ok(
    !isAlive(pids.childPid),
    "a process of the turn's group survived the stop",
  );
  try {
    process.kill(-pids.cliPid, 0);
    assert.fail("the turn's process group still has members");
  } catch (error) {
    assert.ok(
      error instanceof Error && "code" in error && error.code === "ESRCH",
      "the turn's process group still has members",
    );
  }
}

async function run() {
  const daemon = await startDaemon();
  const browser = await connectBrowser();
  await browser.next({ schema: SnapshotMessageSchema });
  const project = ProjectSchema.parse(
    await browser.command({
      type: "project.create",
      name: "Gate M2",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  await browser.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item: chargingPort },
  });

  await moveWith({ browser, projectId: project.id, cli: "claude" });
  await moveWith({ browser, projectId: project.id, cli: "codex" });
  await killMidTurn({ browser, projectId: project.id });

  const history = ChatHistoryResultSchema.parse(
    await browser.command({ type: "chat.history", projectId: project.id }),
  );
  assert.deepEqual(
    history.messages.map(
      (message) => `${message.author.kind}:${message.status}`,
    ),
    [
      "user:done",
      "agent:done",
      "user:done",
      "agent:done",
      "user:done",
      "agent:stopped",
    ],
    "the chat history does not hold the three turns",
  );

  const agents = AgentsCheckResultSchema.parse(
    await browser.command({ type: "agents.check" }),
  );
  assert.deepEqual(
    agents.agents.map((agent) => [
      agent.cli,
      agent.status,
      agent.usage?.error?.kind,
    ]),
    [
      ["claude", "ready", "not-signed-in"],
      ["codex", "ready", "not-signed-in"],
    ],
    "agents.check did not report both fake CLIs",
  );

  browser.socket.close();
  daemon.kill("SIGTERM");
  const [exitCode] = await once(daemon, "exit");
  assert.equal(exitCode, 0, "the daemon did not exit cleanly");
}

try {
  await run();
  process.stdout.write(
    "gate:m2 passed: fake claude and fake codex moved the charging port 0.5 m through scene_apply, diff block undo restored the scene, a stopped turn left no process of its group\n",
  );
} catch (error) {
  process.stderr.write(
    `gate:m2 failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  if (existsSync(pidPath)) {
    const { cliPid } = z
      .object({ cliPid: z.number().int() })
      .parse(JSON.parse(readFileSync(pidPath, "utf8")));
    try {
      process.kill(-cliPid, "SIGKILL");
    } catch {}
  }
  rmSync(root, { recursive: true, force: true });
}
