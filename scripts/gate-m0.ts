import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "planner-gate-m0-"));
const plannerHome = join(root, "home");
const projectsRoot = join(root, "projects");
const daemonFile = join(plannerHome, "daemon.json");
const children: ChildProcess[] = [];

async function startDaemon() {
  const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "user-home"),
      PLANNER_HOME: plannerHome,
      PLANNER_PROJECTS: projectsRoot,
      PLANNER_PORT: "0",
      PLANNER_WRITE_DELAY_MS: "60000",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  for (let attempt = 0; attempt < 100 && !existsSync(daemonFile); attempt++) {
    assert.equal(child.exitCode, null, "the daemon exited before it listened");
    await delay(50);
  }
  const { port, token } = z
    .object({ port: z.number().int().positive(), token: z.string().min(1) })
    .parse(JSON.parse(readFileSync(daemonFile, "utf8")));
  return { child, port, token };
}

async function connect(options: { port: number; token: string }) {
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}/ws`);
  const frames: unknown[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data) => {
    frames.push(JSON.parse(data.toString()));
    for (const wake of waiters.splice(0)) wake();
  });
  await once(socket, "open");
  async function next<T>(schema: z.ZodType<T>) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const index = frames.findIndex(
        (frame) => schema.safeParse(frame).success,
      );
      if (index >= 0) return schema.parse(frames.splice(index, 1).at(0));
      await Promise.race([
        new Promise<void>((resolve) => waiters.push(resolve)),
        delay(200),
      ]);
    }
    throw new Error("Timed out waiting for a WebSocket frame");
  }
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    const ack = await next(
      CommandAckSchema.refine((frame) => frame.requestId === requestId),
    );
    return ack;
  }
  const refused = await command({
    type: "project.open",
    projectId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(refused.ok, false, "a command before the token was accepted");
  socket.send(JSON.stringify({ type: "auth", token: options.token }));
  await next(z.object({ type: z.literal("auth.ok") }));
  const snapshot = await next(SnapshotMessageSchema);
  return { socket, snapshot, command };
}

const commands: Command[] = [
  {
    type: "item.add",
    item: buildItem({
      id: "sofa",
      placement: {
        kind: "floor",
        xM: -1.4,
        zM: 0.2,
        elevationM: 0,
        rotationRad: 0,
      },
    }),
  },
  {
    type: "item.add",
    item: {
      ...buildItem({
        id: "port",
        placement: {
          kind: "wall",
          wallId: "wall-2",
          alongM: 1.2,
          heightM: 0.3,
          rotationRad: 0,
        },
      }),
      sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
    },
  },
  {
    type: "item.add",
    item: buildItem({
      id: "lamp",
      placement: { kind: "ceiling", xM: 0, zM: 0, rotationRad: 0 },
    }),
    index: 1,
  },
  {
    type: "item.update",
    itemId: "sofa",
    patch: {
      name: "Blue sofa",
      colorAdjust: { kind: "colorize", color: "#1e50e6", strength: 0.8 },
    },
  },
  {
    type: "item.duplicate",
    itemId: "sofa",
    newItemId: "sofa-2",
    placement: {
      kind: "floor",
      xM: 1.2,
      zM: -1.1,
      elevationM: 0,
      rotationRad: 1.5,
    },
  },
  { type: "item.remove", itemId: "lamp" },
  {
    type: "room.update",
    walls: [
      { id: "wall-1", startM: { x: -2.5, z: -2.5 }, kind: "solid" },
      { id: "wall-2", startM: { x: -2.5, z: 2.5 }, kind: "solid" },
      { id: "wall-3", startM: { x: 2.5, z: 2.5 }, kind: "inferred" },
      { id: "wall-4", startM: { x: 2.5, z: -2.5 }, kind: "solid" },
    ],
    ceilingHeightM: 2.75,
  },
  { type: "surface.update", surfaceId: "floor", color: "#c8b79a" },
  { type: "surface.update", surfaceId: "wall-2", color: "#f4f1ea" },
  {
    type: "camera.set",
    camera: {
      positionM: { x: 4, y: 3, z: 5 },
      targetM: { x: 0, y: 1, z: 0 },
    },
  },
];

const sofa = {
  name: "Blue sofa",
  model: { kind: "asset", assetId: "asset-sofa" },
  sizeM: { width: 0.7, height: 0.4, depth: 0.3 },
  colorAdjust: { kind: "colorize", color: "#1e50e6", strength: 0.8 },
  locked: false,
} satisfies Omit<Item, "id" | "placement">;

const expectedScene: Scene = {
  version: 1,
  room: {
    walls: [
      { id: "wall-1", startM: { x: -2.5, z: -2.5 }, kind: "solid" },
      { id: "wall-2", startM: { x: -2.5, z: 2.5 }, kind: "solid" },
      { id: "wall-3", startM: { x: 2.5, z: 2.5 }, kind: "inferred" },
      { id: "wall-4", startM: { x: 2.5, z: -2.5 }, kind: "solid" },
    ],
    ceilingHeightM: 2.75,
    surfaces: {
      floor: { color: "#c8b79a" },
      "wall-2": { color: "#f4f1ea" },
    },
  },
  items: [
    {
      ...sofa,
      id: "sofa",
      placement: {
        kind: "floor",
        xM: -1.9,
        zM: 0.2,
        elevationM: 0,
        rotationRad: 0,
      },
    },
    {
      id: "port",
      name: "port",
      model: { kind: "asset", assetId: "asset-port" },
      placement: {
        kind: "wall",
        wallId: "wall-2",
        alongM: 1.2,
        heightM: 0.3,
        rotationRad: 0,
      },
      sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
      locked: false,
    },
    {
      ...sofa,
      id: "sofa-2",
      placement: {
        kind: "floor",
        xM: 1.7,
        zM: -1.1,
        elevationM: 0,
        rotationRad: 1.5,
      },
    },
  ],
  camera: {
    positionM: { x: 4, y: 3, z: 5 },
    targetM: { x: 0, y: 1, z: 0 },
  },
};

async function run() {
  const first = await startDaemon();
  const client = await connect(first);
  assert.deepEqual(client.snapshot.projects, []);

  const created = await client.command({
    type: "project.create",
    name: "Gate",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  assert.equal(created.ok, true, "project.create failed");
  const project = ProjectSchema.parse(created.ok ? created.result : undefined);
  const projectFile = join(projectsRoot, project.id, "project.json");

  const sent = new Set<string>(commands.map((command) => command.type));
  for (const type of [
    "item.add",
    "item.update",
    "item.duplicate",
    "item.remove",
    "room.update",
    "surface.update",
    "camera.set",
  ])
    assert.ok(sent.has(type), `no ${type} command is sent`);

  let expected = project.scene;
  for (const [index, command] of commands.entries()) {
    const applied = applyCommand({ scene: expected, command });
    assert.equal(applied.kind, "applied", `${command.type} was rejected`);
    if (applied.kind === "applied") expected = applied.scene;
    const ack = await client.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
    assert.deepEqual(
      ack.ok ? ack.result : ack.error,
      { revision: index + 1 },
      `${command.type} was not acknowledged`,
    );
  }
  const rejected = await client.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.remove", itemId: "ghost" },
  });
  assert.equal(rejected.ok, false, "an invalid command was accepted");

  assert.deepEqual(
    expected,
    expectedScene,
    "the shared reducer does not give the expected scene",
  );

  assert.ok(
    ProjectSchema.parse(JSON.parse(readFileSync(projectFile, "utf8")))
      .revision < commands.length,
    "project.json was written before SIGTERM, so the flush is not tested",
  );
  first.child.kill("SIGTERM");
  const [exitCode] = await once(first.child, "exit");
  assert.equal(exitCode, 0, "the daemon did not exit cleanly on SIGTERM");
  assert.equal(existsSync(daemonFile), false, "daemon.json was left behind");
  assert.deepEqual(
    ProjectSchema.parse(JSON.parse(readFileSync(projectFile, "utf8"))),
    { ...project, revision: commands.length, scene: expected },
    "project.json does not hold the expected scene after SIGTERM",
  );

  const second = await startDaemon();
  assert.notEqual(second.token, first.token, "the token did not change");
  const reader = await connect(second);
  assert.deepEqual(reader.snapshot.projects, [
    { id: project.id, name: "Gate" },
  ]);
  const opened = await reader.command({
    type: "project.open",
    projectId: project.id,
  });
  assert.equal(opened.ok, true, "project.open failed after the restart");
  assert.deepEqual(
    ProjectSchema.parse(opened.ok ? opened.result : undefined),
    { ...project, revision: commands.length, scene: expected },
    "the scene read back after the restart is not the expected scene",
  );
  reader.socket.close();
  second.child.kill("SIGINT");
  const [secondExitCode] = await once(second.child, "exit");
  assert.equal(secondExitCode, 0, "the daemon did not exit cleanly on SIGINT");
  return commands.length;
}

try {
  const count = await run();
  process.stdout.write(
    `gate:m0 passed: ${count} commands, 7 command types, scene equal after restart\n`,
  );
} catch (error) {
  process.stderr.write(
    `gate:m0 failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
}
