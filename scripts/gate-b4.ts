import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { chromium } from "@playwright/test";
import validator from "gltf-validator";
import { WebSocket } from "ws";
import { z } from "zod";
import { listCatalogAssetIds } from "../packages/daemon/src/catalog/list-catalog-asset-ids.ts";
import { serveInspectPage } from "./b4/serve-inspect-page.ts";

declare global {
  interface Window {
    inspectReady?: boolean;
    inspectGlb: (url: string) => Promise<unknown>;
  }
}

const SIZE_TOLERANCE_M = 0.001;
const STEP_TIMEOUT_MS = 30_000;
const GATE_TIMEOUT_MS = 300_000;
const THUMBNAIL_SIZE_PX = 256;
const repo = resolve(import.meta.dirname, "..");
const catalogRoot = join(repo, "packages/daemon/catalog");
const root = mkdtempSync(join(tmpdir(), "planner-gate-b4-"));
const plannerHome = join(root, "home");
const projectsRoot = join(root, "projects");
const children: ChildProcess[] = [];

const GlbReportSchema = z.object({
  min: z.tuple([z.number(), z.number(), z.number()]),
  max: z.tuple([z.number(), z.number(), z.number()]),
  meshCount: z.number(),
  transformedMeshCount: z.number(),
  triangleCount: z.number(),
});

function withTimeout<T>(options: { promise: Promise<T>; label: string }) {
  return Promise.race([
    options.promise,
    delay(STEP_TIMEOUT_MS, undefined, { ref: false }).then(() => {
      throw new Error(
        `${options.label} took longer than ${STEP_TIMEOUT_MS} ms`,
      );
    }),
  ]);
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function checkCatalog() {
  assert.deepEqual(
    [...listCatalogAssetIds(catalogRoot)].toSorted(),
    CHARGING_PORT_TYPES.map((entry) => entry.assetId).toSorted(),
    "the catalog folders and the shared charging port types differ",
  );
  const server = await serveInspectPage({
    roots: {
      page: join(repo, "scripts/b4"),
      three: join(repo, "node_modules/three"),
      catalog: catalogRoot,
    },
  });
  const browser = await chromium
    .launch({ timeout: STEP_TIMEOUT_MS })
    .catch(async (error: unknown) => {
      await server.close();
      throw error;
    });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    await page.goto(`${server.baseUrl}/page/inspect.html`);
    await page.waitForFunction(() => window.inspectReady === true);
    for (const entry of CHARGING_PORT_TYPES) {
      const folder = join(catalogRoot, entry.assetId);
      const meta = AssetMetaSchema.parse(
        JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")),
      );
      assert.deepEqual(
        {
          id: meta.id,
          kind: meta.kind,
          mount: meta.mount,
          nativeSizeM: meta.nativeSizeM,
        },
        {
          id: entry.assetId,
          kind: "catalog",
          mount: entry.mount,
          nativeSizeM: entry.sizeM,
        },
        `${entry.typeId}: meta.json does not match the shared entry`,
      );
      const glb = readFileSync(join(folder, "model.glb"));
      const validation = await withTimeout({
        promise: validator.validateBytes(new Uint8Array(glb), {
          uri: `${entry.assetId}/model.glb`,
        }),
        label: `${entry.typeId}: the glTF validator`,
      });
      assert.equal(
        validation.issues.numErrors,
        0,
        `${entry.typeId}: the glTF validator found ${validation.issues.numErrors} errors`,
      );
      const report = GlbReportSchema.parse(
        await withTimeout({
          promise: page.evaluate(
            (url) => window.inspectGlb(url),
            `/catalog/${entry.assetId}/model.glb`,
          ),
          label: `${entry.typeId}: loading the GLB in three.js`,
        }),
      );
      assert.equal(
        report.transformedMeshCount,
        0,
        `${entry.typeId}: a mesh node has a transform`,
      );
      assert.equal(
        report.triangleCount,
        meta.triangleCount,
        `${entry.typeId}: meta.json triangleCount differs from the GLB`,
      );
      const scale = {
        width: entry.sizeM.width / meta.nativeSizeM.width,
        height: entry.sizeM.height / meta.nativeSizeM.height,
        depth: entry.sizeM.depth / meta.nativeSizeM.depth,
      };
      const placed = {
        min: [
          report.min[0] * scale.width,
          report.min[1] * scale.height,
          report.min[2] * scale.depth,
        ],
        max: [
          report.max[0] * scale.width,
          report.max[1] * scale.height,
          report.max[2] * scale.depth,
        ],
      };
      const size = [0, 1, 2].map(
        (axis) => (placed.max[axis] ?? 0) - (placed.min[axis] ?? 0),
      );
      const expected = [
        entry.sizeM.width,
        entry.sizeM.height,
        entry.sizeM.depth,
      ];
      for (const [axis, value] of size.entries())
        assert.ok(
          Math.abs(value - (expected[axis] ?? 0)) <= SIZE_TOLERANCE_M,
          `${entry.typeId}: size on axis ${axis} is ${value} m, expected ${expected[axis]} m`,
        );
      const anchor = [
        ((placed.min[0] ?? 0) + (placed.max[0] ?? 0)) / 2,
        ((placed.min[1] ?? 0) + (placed.max[1] ?? 0)) / 2,
        placed.min[2] ?? 0,
      ];
      assert.ok(
        anchor.every((value) => Math.abs(value) <= SIZE_TOLERANCE_M),
        `${entry.typeId}: the back-face centre is at ${anchor.join(" ")}, not the origin`,
      );
      const thumb = readFileSync(join(folder, "thumb.png"));
      assert.equal(
        thumb.toString("ascii", 1, 4),
        "PNG",
        `${entry.typeId}: thumb.png is not a PNG`,
      );
      assert.deepEqual(
        [thumb.readUInt32BE(16), thumb.readUInt32BE(20)],
        [THUMBNAIL_SIZE_PX, THUMBNAIL_SIZE_PX],
        `${entry.typeId}: thumb.png is not ${THUMBNAIL_SIZE_PX} px square`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await withTimeout({
    promise: once(server, "listening"),
    label: "finding a free port",
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  server.close();
  await withTimeout({
    promise: once(server, "close"),
    label: "releasing the free port",
  });
  return address.port;
}

async function startDaemon(options: { port: number; webOrigin: string }) {
  const child = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "user-home"),
      PLANNER_HOME: plannerHome,
      PLANNER_PROJECTS: projectsRoot,
      PLANNER_PORT: String(options.port),
      PLANNER_WEB_ORIGIN: options.webOrigin,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  for (
    let attempt = 0;
    attempt < 100 && !existsSync(join(plannerHome, "daemon.json"));
    attempt++
  ) {
    assert.equal(child.exitCode, null, "the daemon exited before it listened");
    await delay(50);
  }
  return child;
}

async function connect(options: { port: number; webOrigin: string }) {
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}/ws`, {
    headers: { origin: options.webOrigin },
  });
  const unread: unknown[] = [];
  socket.on("message", (data) => unread.push(JSON.parse(data.toString())));
  await withTimeout({
    promise: once(socket, "open"),
    label: "opening the WebSocket",
  });
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
  await next(SnapshotMessageSchema);
  return { socket, command };
}

async function checkTypeSwitch() {
  const port = Number(process.env.PLANNER_PORT) || (await freePort());
  const webOrigin = `http://localhost:${Number(process.env.PLANNER_WEB_PORT) || (await freePort())}`;
  const daemon = await startDaemon({ port, webOrigin });
  const client = await connect({ port, webOrigin });
  const project = ProjectSchema.parse(
    await client.command({
      type: "project.create",
      name: "Gate B4",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const placed: Item = {
    id: "port",
    name: CHARGING_PORT.name,
    model: { kind: "asset", assetId: CHARGING_PORT.assetId },
    placement: {
      kind: "wall",
      wallId: "wall-2",
      alongM: 1.37,
      heightM: 0.45,
      rotationRad: 0,
    },
    sizeM: CHARGING_PORT.sizeM,
    locked: false,
  };
  async function apply(command: Command) {
    await client.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
    const opened = ProjectSchema.parse(
      await client.command({ type: "project.open", projectId: project.id }),
    );
    const item = opened.scene.items.find(
      (candidate) => candidate.id === "port",
    );
    assert.ok(item, "the port is not in the scene");
    return { scene: opened.scene, item };
  }

  const before = await apply({ type: "item.add", item: placed });
  for (const entry of CHARGING_PORT_TYPES.filter(
    (type) => type.assetId !== CHARGING_PORT.assetId,
  )) {
    const switchCommand: Command = {
      type: "item.update",
      itemId: "port",
      patch: {
        model: { kind: "asset", assetId: entry.assetId },
        sizeM: entry.sizeM,
      },
    };
    const undo = invertCommand({ scene: before.scene, command: switchCommand });
    assert.ok(undo, "the switch has no inverse");
    const switched = await apply(switchCommand);
    assert.deepEqual(
      switched.item.placement,
      placed.placement,
      `${entry.typeId}: the switch moved the port`,
    );
    assert.deepEqual(
      switched.item.model,
      { kind: "asset", assetId: entry.assetId },
      `${entry.typeId}: the switch did not change the asset`,
    );
    assert.deepEqual(switched.item.sizeM, entry.sizeM);
    for (const file of ["model.glb", "meta.json", "thumb.png"])
      assert.equal(
        sha256(join(projectsRoot, project.id, "assets", entry.assetId, file)),
        sha256(join(catalogRoot, entry.assetId, file)),
        `${entry.typeId}: ${file} was not copied into the project`,
      );
    const undone = await apply(undo);
    assert.deepEqual(
      undone.scene,
      before.scene,
      `${entry.typeId}: undo did not restore the previous type`,
    );
  }

  client.socket.close();
  daemon.kill("SIGTERM");
  const [exitCode] = await withTimeout({
    promise: once(daemon, "exit"),
    label: "stopping the daemon",
  });
  assert.equal(exitCode, 0, "the daemon did not exit cleanly");
}

const watchdog = setTimeout(() => {
  process.stderr.write(
    `gate:b4 failed: the gate took longer than ${GATE_TIMEOUT_MS} ms\n`,
  );
  for (const child of children) child.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}, GATE_TIMEOUT_MS);
watchdog.unref();

try {
  await checkCatalog();
  await checkTypeSwitch();
  process.stdout.write(
    `gate:b4 passed: ${CHARGING_PORT_TYPES.length} catalog GLBs valid, sized within 1 mm and anchored at the back-face centre; switching through WS keeps alongM and heightM, copies the asset, and undo restores the type\n`,
  );
} catch (error) {
  process.stderr.write(
    `gate:b4 failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
}
