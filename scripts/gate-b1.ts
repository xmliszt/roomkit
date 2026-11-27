import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import {
  ProjectSchema,
  ProjectSummarySchema,
} from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import { SnapshotSaveResultSchema } from "@planner/shared/src/protocol/snapshot-save-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "planner-gate-b1-"));
const plannerHome = join(root, "home");
const projectsRoot = join(root, "projects");
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
const base = `http://127.0.0.1:${port}`;

async function startDaemon() {
  const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "user-home"),
      PLANNER_HOME: plannerHome,
      PLANNER_PROJECTS: projectsRoot,
      PLANNER_PORT: String(port),
      PLANNER_WEB_ORIGIN: webOrigin,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const daemonFile = join(plannerHome, "daemon.json");
  for (let attempt = 0; attempt < 100 && !existsSync(daemonFile); attempt++) {
    assert.equal(child.exitCode, null, "the daemon exited before it listened");
    await delay(50);
  }
  const { token } = z
    .object({ token: z.string().min(1) })
    .parse(JSON.parse(readFileSync(daemonFile, "utf8")));
  return { child, token };
}

async function connect(headers: { [name: string]: string }) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const received: unknown[] = [];
  const unread: unknown[] = [];
  socket.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    received.push(frame);
    unread.push(frame);
  });
  await once(socket, "open");
  async function next<T>(schema: z.ZodType<T>) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const index = unread.findIndex(
        (frame) => schema.safeParse(frame).success,
      );
      if (index >= 0) return schema.parse(unread.splice(index, 1).at(0));
      await delay(10);
    }
    throw new Error("Timed out waiting for a WebSocket frame");
  }
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    const ack = await next(
      CommandAckSchema.refine((frame) => frame.requestId === requestId),
    );
    assert.ok(ack.ok, `${request.type} failed: ${ack.ok ? "" : ack.error}`);
    return ack.result;
  }
  return { socket, received, next, command };
}

function fetchDaemon(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { origin: webOrigin },
  });
}

function listFiles(projectId: string) {
  const folder = join(projectsRoot, projectId);
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !relative(folder, path).startsWith(".planner"))
    .map((path) => ({
      path: relative(folder, path),
      sha256: createHash("sha256")
        .update(path.endsWith("project.json") ? "" : readFileSync(path))
        .digest("hex"),
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

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

async function run() {
  const daemon = await startDaemon();
  const script = await connect({});
  const browser = await connect({ origin: webOrigin });
  await browser.next(SnapshotMessageSchema);

  const project = ProjectSchema.parse(
    await browser.command({
      type: "project.create",
      name: "Gate B1",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  await browser.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item: chargingPort },
  });
  const model = await fetchDaemon(
    `/projects/${project.id}/assets/${CHARGING_PORT.assetId}/model.glb`,
  );
  assert.equal(model.status, 200, "the charging port GLB is not served");
  assert.equal(
    Buffer.from(await model.arrayBuffer()).toString("ascii", 0, 4),
    "glTF",
    "the charging port asset is not a GLB",
  );

  const photo = await fetchDaemon(
    `/projects/${project.id}/photos?origin=capture&fileName=IMG_0001.HEIC`,
    {
      method: "POST",
      body: readFileSync("packages/daemon/test/fixtures/oriented.heic"),
    },
  );
  assert.equal(photo.status, 201, "the photo upload failed");
  const { fileName: photoFile } = PhotoUploadResultSchema.parse(
    await photo.json(),
  );
  const snapshot = await fetchDaemon(`/projects/${project.id}/snapshots`, {
    method: "POST",
    body: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("png body"),
    ]),
  });
  assert.equal(snapshot.status, 201, "the snapshot save failed");
  const { fileName: snapshotFile } = SnapshotSaveResultSchema.parse(
    await snapshot.json(),
  );
  assert.ok(
    existsSync(join(projectsRoot, project.id, "photos", photoFile)) &&
      existsSync(join(projectsRoot, project.id, "snapshots", snapshotFile)),
    "the photo or the snapshot is not in the project folder",
  );

  const exported = await fetchDaemon(`/projects/${project.id}/export`);
  assert.equal(exported.status, 200, "the export failed");
  const imported = await fetchDaemon("/projects/import", {
    method: "POST",
    body: Buffer.from(await exported.arrayBuffer()),
  });
  assert.equal(imported.status, 201, "the import failed");
  const copy = ProjectSummarySchema.parse(await imported.json());
  assert.notEqual(copy.id, project.id, "the import kept the project id");
  const opened = ProjectSchema.parse(
    await browser.command({ type: "project.open", projectId: copy.id }),
  );
  const original = ProjectSchema.parse(
    await browser.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(
    opened,
    { ...original, id: copy.id },
    "the imported project differs",
  );
  assert.deepEqual(
    listFiles(copy.id),
    listFiles(project.id),
    "the imported files differ in name or bytes",
  );

  await browser.command({
    type: "project.rename",
    projectId: copy.id,
    name: "Gate B1 copy",
  });
  await browser.command({ type: "project.remove", projectId: project.id });
  assert.equal(
    existsSync(join(projectsRoot, project.id)),
    false,
    "the removed project folder is still in place",
  );
  assert.ok(
    readdirSync(join(projectsRoot, ".trash")).some((name) =>
      name.startsWith(project.id),
    ),
    "the removed project is not in .trash",
  );

  assert.deepEqual(
    script.received,
    [],
    "a socket with no Origin got frames before auth",
  );
  script.socket.send(JSON.stringify({ type: "auth", token: daemon.token }));
  const afterAuth = await script.next(SnapshotMessageSchema);
  const first = ServerMessageSchema.parse(script.received.at(0));
  assert.equal(first.type, "auth.ok", "the first frame is not auth.ok");
  assert.equal(script.received.length, 2, "more than auth.ok and the snapshot");
  assert.deepEqual(
    afterAuth.projects,
    [{ id: copy.id, name: "Gate B1 copy" }],
    "the snapshot does not list only the renamed copy",
  );

  script.socket.close();
  browser.socket.close();
  daemon.child.kill("SIGTERM");
  const [exitCode] = await once(daemon.child, "exit");
  assert.equal(exitCode, 0, "the daemon did not exit cleanly");
}

try {
  await run();
  process.stdout.write(
    "gate:b1 passed: port added, photo, snapshot, export, import with a new id, rename, remove, no frames before auth.ok\n",
  );
} catch (error) {
  process.stderr.write(
    `gate:b1 failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
}
