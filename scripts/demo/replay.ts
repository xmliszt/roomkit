#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { chromium } from "@playwright/test";
import { InventoryRecordSchema } from "../../packages/daemon/src/inventory/inventory-record-schema.ts";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "../b6/create-recon-fixture.ts";
import { prepareReplay } from "./prepare-replay.ts";
import { seedReplayProject } from "./seed-replay-project.ts";
import { watchProcesses } from "./watch-processes.ts";

const args = parseArgs({
  allowPositionals: true,
  options: {
    "piece-seconds": { type: "string", default: "6" },
    "recon-seconds": { type: "string", default: "20" },
    "render-seconds": { type: "string", default: "3" },
    "render-image": { type: "string" },
    "max-appearing": { type: "string" },
    record: { type: "string" },
    name: { type: "string" },
    finish: { type: "boolean", default: false },
    "hold-item": { type: "string", multiple: true, default: [] },
  },
});
assert.equal(
  args.positionals.length,
  1,
  "Usage: scripts/demo/replay.ts <project-folder> [--piece-seconds 6] [--recon-seconds 20] [--render-seconds 3] [--render-image <png>] [--max-appearing 3] [--record <out.webm>] [--name <project title>] [--finish] [--hold-item <name prefix>]...",
);
for (const key of ["piece-seconds", "recon-seconds"] as const)
  assert.ok(
    Number.isFinite(Number(args.values[key])) && Number(args.values[key]) > 0,
    `${key} must be positive seconds`,
  );
const maxAppearing = args.values["max-appearing"];
assert.ok(
  Number.isFinite(Number(args.values["render-seconds"])) &&
    Number(args.values["render-seconds"]) >= 0,
  "render-seconds must be non-negative seconds",
);
if (maxAppearing !== undefined)
  assert.ok(
    Number.isInteger(Number(maxAppearing)) && Number(maxAppearing) > 0,
    "max-appearing must be a positive whole number",
  );
const recording = args.values.record ? resolve(args.values.record) : undefined;
if (recording)
  assert.equal(extname(recording), ".webm", "Recording must end in .webm");
if (recording) {
  const source = realpathSync(args.positionals.at(0) ?? "");
  let parent = dirname(recording);
  while (!existsSync(parent)) parent = dirname(parent);
  const resolvedParent = realpathSync(parent);
  assert.ok(
    resolvedParent !== source && !resolvedParent.startsWith(`${source}${sep}`),
    "Recording must be outside the read-only source project",
  );
  for (const extension of [".webm", ".mp4", ".png"])
    assert.ok(
      !existsSync(recording.replace(/\.webm$/, extension)),
      `Output exists: ${recording.replace(/\.webm$/, extension)}`,
    );
}
const renderImage = args.values["render-image"]
  ? realpathSync(args.values["render-image"])
  : undefined;
if (renderImage)
  assert.ok(statSync(renderImage).isFile(), "render-image must be a PNG file");
const started = Date.now();
const fixture = await createReconFixture({ keep: true });
const heartbeat = setInterval(
  () =>
    process.stdout.write(
      `replay: ${Math.round((Date.now() - started) / 1000)}s\n`,
    ),
  5000,
);
const audit = watchProcesses({
  rootPid: process.pid,
  path: join(fixture.root, "processes.jsonl"),
});
let web: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let daemon: Awaited<ReturnType<typeof fixture.start>> | undefined;
let interrupted = false;
function interrupt() {
  if (interrupted) {
    if (web?.pid && web.exitCode === null && web.signalCode === null)
      process.kill(-web.pid, "SIGKILL");
    daemon?.child.kill("SIGKILL");
    process.exit(130);
  }
  interrupted = true;
  browser?.close().catch(() => undefined);
}
async function stopDaemon() {
  if (!daemon || daemon.child.exitCode !== null || daemon.child.signalCode)
    return;
  if (interrupted)
    await Promise.race([
      once(daemon.child, "exit"),
      delay(3000, undefined, { ref: false }),
    ]);
  if (daemon.child.exitCode === null && daemon.child.signalCode === null)
    await daemon.stop();
}
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
for (const signal of signals) process.on(signal, interrupt);
try {
  process.stdout.write(`Replay data: ${fixture.root}\n`);
  const saved = prepareReplay({
    source: args.positionals.at(0) ?? "",
    root: fixture.root,
  });
  const holds = args.values["hold-item"];
  const held = saved.entries.filter((entry) =>
    holds.some((prefix) => entry.item.name.startsWith(prefix)),
  );
  for (const prefix of holds)
    assert.ok(
      held.some((entry) => entry.item.name.startsWith(prefix)),
      `No item starts with ${prefix}`,
    );
  for (const entry of held)
    assert.ok(
      !entry.sourceObjectId && !entry.catalog,
      `${entry.item.name} is not a generated item added after the inventory`,
    );
  const entries = saved.entries.filter((entry) => !held.includes(entry));
  Object.assign(fixture.env, {
    DEMO_SOURCE: saved.snapshot,
    DEMO_HELD: JSON.stringify(held.map((entry) => entry.item.name)),
    DEMO_PIECE_SECONDS: args.values["piece-seconds"],
    DEMO_RECON_SECONDS: args.values["recon-seconds"],
    DEMO_RENDER_SECONDS: args.values["render-seconds"],
    DEMO_RENDER_IMAGE: renderImage,
    DEMO_CALLS: join(fixture.root, "calls.jsonl"),
    PLANNER_CLAUDE_BIN: resolve("scripts/demo/fake-agent.mjs"),
    PLANNER_CODEX_BIN: resolve("scripts/demo/fake-agent.mjs"),
    PLANNER_PYTHON_BIN: resolve("scripts/demo/fake-python.mjs"),
    BLENDER: resolve("scripts/demo/fake-blender.mjs"),
    PLANNER_BREW_BIN: join(fixture.root, "no-brew"),
    PLANNER_UV_BIN: join(fixture.root, "no-uv"),
  });
  const project = seedReplayProject({
    saved: { ...saved, entries },
    root: fixture.root,
    name: args.values.name ?? `${saved.project.name} · replay`,
  });
  const folder = join(fixture.root, "projects", project.id);
  daemon = await fixture.start();
  process.stdout.write(`Daemon port: ${fixture.env.PLANNER_PORT}\n`);
  await daemon.command({
    type: "language.set",
    locale: "en",
    firstLaunch: true,
  });
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: Object.fromEntries(
      Object.keys(config.roles).map((role) => [
        role,
        { cli: "claude", model: "replay" },
      ]),
    ),
  });
  const walls = saved.project.scene.room.walls;
  const xs = walls.map((wall) => wall.startM.x);
  const zs = walls.map((wall) => wall.startM.z);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
  );
  const camera = {
    positionM: {
      x: center.x + span * 1.5,
      y: span * 1.3,
      z: center.z + span * 1.5,
    },
    targetM: {
      x: center.x,
      y: saved.project.scene.room.ceilingHeightM / 3,
      z: center.z,
    },
  };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  const url = `http://localhost:${fixture.env.PLANNER_WEB_PORT}/projects/${project.id}`;
  let webOutput = "";
  web = spawn(
    process.execPath,
    [
      resolve("apps/web/node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      fixture.env.PLANNER_WEB_PORT ?? "",
    ],
    {
      cwd: resolve("apps/web"),
      env: {
        ...fixture.env,
        NODE_ENV: "development",
        ...(maxAppearing !== undefined
          ? { NEXT_PUBLIC_PLANNER_MAX_APPEARING: maxAppearing }
          : {}),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout?.on("data", (chunk) => {
    webOutput += chunk.toString();
  });
  web.stderr?.on("data", (chunk) => {
    webOutput += chunk.toString();
  });
  web.on("error", (error) => {
    webOutput += error.message;
  });
  const deadline = Date.now() + 120000;
  while (true) {
    assert.ok(!interrupted, "Replay interrupted");
    assert.equal(web.exitCode, null, webOutput);
    assert.ok(Date.now() < deadline, `Web app did not start: ${webOutput}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch {}
    await delay(200);
  }
  process.stdout.write(`Project URL: ${url}\n`);
  browser = await chromium.launch({
    headless: Boolean(recording) || args.values.finish,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ["--use-angle=metal", "--enable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
    ...(recording
      ? {
          recordVideo: {
            dir: join(fixture.root, "video"),
            size: { width: 1440, height: 900 },
          },
        }
      : {}),
  });
  await context.addInitScript(() =>
    localStorage.setItem("planner:object-labels", "false"),
  );
  await context.addInitScript(() => {
    const peak = { appearing: 0 };
    Object.assign(window, { replayPeak: peak });
    setInterval(() => {
      peak.appearing = Math.max(
        peak.appearing,
        document.querySelectorAll(
          '[data-generation-stage="ready"], [data-generation-stage="generating"]',
        ).length,
      );
    }, 50);
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.locator("canvas").waitFor();
  await page.getByRole("button", { name: "labelsL", exact: true }).waitFor();
  await page.mouse.move(1430, 10);
  await daemon.command({ type: "reconstruction.start", projectId: project.id });
  const runDeadline =
    Date.now() +
    180000 +
    Number(args.values["recon-seconds"]) * 1000 +
    entries.length * Number(args.values["piece-seconds"]) * 1000;
  const released = new Set<string>();
  let maxGenerating = 0;
  const replayIds: { [key: string]: string } = {};
  let lateQueued = false;
  let outcome: ReturnType<typeof InventoryRecordSchema.parse>["outcome"];
  while (true) {
    assert.ok(!interrupted, "Replay interrupted");
    assert.ok(Date.now() < runDeadline, "Replay pipeline timed out");
    assert.equal(audit.violations.length, 0, audit.violations.join("\n"));
    const jobs = daemon.frames.flatMap((frame) =>
      frame.type === "event" && frame.event.kind === "job.updated"
        ? [frame.event.job]
        : [],
    );
    const latest = Object.values(
      Object.fromEntries(jobs.map((job) => [job.id, job])),
    );
    const failed = latest.find((job) => job.stage === "failed");
    assert.ok(!failed, failed?.error);
    maxGenerating = Math.max(
      maxGenerating,
      latest.filter(
        (job) => job.kind === "generation" && job.stage === "generating",
      ).length,
    );
    assert.ok(maxGenerating <= 2, "More than two pieces generating");
    const inventory = latest.find(
      (job) => job.kind === "inventory" && job.stage === "done",
    );
    if (inventory && !outcome) {
      const records: unknown[] = JSON.parse(
        readFileSync(join(folder, ".planner", "jobs.json"), "utf8"),
      );
      outcome = records
        .map((record) => InventoryRecordSchema.safeParse(record))
        .find((parsed) => parsed.success && parsed.data.job.id === inventory.id)
        ?.data?.outcome;
      assert.ok(outcome?.objectIds, "Replay inventory has no object mapping");
    }
    if (outcome?.objectIds) {
      for (const entry of entries.filter((entry) => entry.sourceObjectId)) {
        if (entry.item.model.kind !== "asset") continue;
        const item = outcome.items.at(
          outcome.objectIds.indexOf(entry.objectId),
        );
        assert.ok(item?.model.kind === "pending");
        replayIds[entry.item.id] = item.id;
        if (!released.has(item.id)) {
          await daemon.command({
            type: "generation.start",
            projectId: project.id,
            itemId: item.id,
          });
          released.add(item.id);
        }
      }
      if (
        !lateQueued &&
        latest.filter(
          (job) => job.kind === "generation" && job.stage === "ready",
        ).length === entries.filter((entry) => entry.sourceObjectId).length
      ) {
        for (const entry of entries.filter((entry) => !entry.sourceObjectId)) {
          const item = {
            ...entry.item,
            light: undefined,
            model: { kind: "pending", jobId: entry.replayJobId },
          };
          await daemon.command({
            type: "scene.apply",
            projectId: project.id,
            command: { type: "item.add", item },
          });
          replayIds[entry.item.id] = entry.item.id;
          if (entry.catalog) {
            await delay(Number(args.values["piece-seconds"]) * 1000);
            await daemon.command({
              type: "scene.apply",
              projectId: project.id,
              command: {
                type: "item.update",
                itemId: item.id,
                patch: { model: entry.item.model },
              },
            });
          } else {
            await daemon.command({
              type: "generation.start",
              projectId: project.id,
              itemId: item.id,
            });
            released.add(item.id);
          }
        }
        lateQueued = true;
      }
      if (
        lateQueued &&
        latest.filter(
          (job) => job.kind === "generation" && job.stage === "ready",
        ).length === released.size &&
        latest.some((job) => job.kind === "surface") &&
        latest.every(
          (job) =>
            ![
              "queued",
              "generating",
              "running",
              "rendering",
              "asking",
            ].includes(job.stage),
        )
      )
        break;
    }
    await delay(100);
  }
  assert.ok(outcome?.objectIds);
  const finished = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.equal(finished.scene.items.length, entries.length);
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "room.update",
      walls: saved.project.scene.room.walls,
      ceilingHeightM: saved.project.scene.room.ceilingHeightM,
      placements: Object.fromEntries(
        entries.map((entry) => {
          const id = replayIds[entry.item.id];
          assert.ok(id);
          return [id, entry.item.placement];
        }),
      ),
    },
  });
  for (const entry of entries) {
    const replayId = replayIds[entry.item.id];
    const item: Item | undefined = finished.scene.items.find(
      (item) => item.id === replayId,
    );
    assert.ok(item);
    assert.equal(item.model.kind, entry.item.model.kind, entry.item.name);
    if (item.model.kind === "asset" && entry.item.model.kind === "asset") {
      for (const name of [
        "model.glb",
        "points.bin",
        "lines.bin",
        "thumb.png",
        "colorMask.png",
      ])
        if (
          existsSync(
            join(saved.snapshot, "assets", entry.item.model.assetId, name),
          )
        )
          assert.deepEqual(
            readFileSync(join(folder, "assets", item.model.assetId, name)),
            readFileSync(
              join(saved.snapshot, "assets", entry.item.model.assetId, name),
            ),
            `${entry.item.name}: ${name}`,
          );
    }
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "item.update",
        itemId: item.id,
        patch: {
          name: entry.item.name,
          placement: entry.item.placement,
          sizeM: entry.item.sizeM,
          locked: entry.item.locked,
          colorAdjust: entry.item.colorAdjust ?? null,
          mirrored: entry.item.mirrored ?? null,
          cutsOpening: entry.item.cutsOpening ?? null,
          light: entry.item.light ?? null,
        },
      },
    });
  }
  for (const [surfaceId, surface] of Object.entries(
    saved.project.scene.room.surfaces,
  ))
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "surface.update", surfaceId, ...surface },
    });
  await page.waitForFunction(
    ({ itemCount, assetCount }) => {
      const scene = document.querySelector('[data-testid="scene"]');
      const items: { model: { kind: string } }[] = JSON.parse(
        scene?.getAttribute("data-items") ?? "[]",
      );
      return (
        items.length === itemCount &&
        items.filter((item) => item.model.kind === "asset").length ===
          assetCount &&
        document.querySelectorAll(
          '[data-generation-stage="ready"], [data-generation-stage="generating"]',
        ).length === 0
      );
    },
    { itemCount: entries.length, assetCount: entries.length },
    { timeout: 120000 },
  );
  await delay(1000);
  const peakAppearing = await page.evaluate(() =>
    "replayPeak" in window &&
    typeof window.replayPeak === "object" &&
    window.replayPeak !== null &&
    "appearing" in window.replayPeak
      ? Number(window.replayPeak.appearing)
      : 0,
  );
  assert.deepEqual(pageErrors, [], "Browser errors");
  assert.equal(
    await page
      .getByRole("button", { name: "labelsL", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  const final = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(final.scene.room, saved.project.scene.room);
  for (const entry of entries) {
    const id = replayIds[entry.item.id];
    const item: Item | undefined = final.scene.items.find(
      (item) => item.id === id,
    );
    assert.ok(item);
    assert.deepEqual(
      { ...item, id: entry.item.id, model: entry.item.model },
      entry.item,
    );
  }
  await page.screenshot({ path: join(fixture.root, "final.png") });
  if (recording) {
    mkdirSync(dirname(recording), { recursive: true });
    await page.screenshot({ path: recording.replace(/\.webm$/, ".png") });
    const video = page.video();
    assert.ok(video);
    await context.close();
    await video.saveAs(recording);
    const mp4 = recording.replace(/\.webm$/, ".mp4");
    assert.ok(!existsSync(mp4), `Output exists: ${mp4}`);
    const encoder = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-i",
        recording,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ],
      { stdio: "inherit" },
    );
    const [code] = await once(encoder, "exit");
    assert.equal(code, 0, "ffmpeg failed");
    assert.ok(statSync(mp4).size > 0);
    process.stdout.write(`Recording: ${recording}\nMP4: ${mp4}\n`);
  } else if (!args.values.finish) {
    process.stdout.write(
      "Replay complete. Press Ctrl-C to stop the temporary app.\n",
    );
    while (!interrupted && browser.isConnected()) await delay(200);
  }
  const processes = audit.stop();
  assert.deepEqual(processes.violations, []);
  await stopDaemon();
  const stopped = ProjectSchema.parse(
    JSON.parse(readFileSync(join(folder, "project.json"), "utf8")),
  );
  const failedJobs = Object.values(
    Object.fromEntries(
      daemon.frames.flatMap((frame) =>
        frame.type === "event" && frame.event.kind === "job.updated"
          ? [[frame.event.job.id, frame.event.job]]
          : [],
      ),
    ),
  ).filter((job) => job.stage === "failed");
  writeJson({
    path: join(fixture.root, "result.json"),
    value: {
      sourceProjectId: saved.project.id,
      projectId: project.id,
      items: stopped.scene.items.length,
      assets: stopped.scene.items.filter((item) => item.model.kind === "asset")
        .length,
      held: held.map((entry) => entry.item.name),
      omitted: saved.omitted,
      failedJobs: failedJobs.map((job) => ({ id: job.id, error: job.error })),
      processAudit: processes,
      maxGenerating,
      peakAppearing,
      elapsedSeconds: (Date.now() - started) / 1000,
      url,
    },
  });

  assert.deepEqual(failedJobs, [], "Failed jobs");
  process.stdout.write(
    `gate:b22 passed: ${stopped.scene.items.length} items, ${released.size} saved assets, peak ${maxGenerating} generating, peak ${peakAppearing} appearing, ${processes.processes} observed processes, no real CLI or model worker; ${Math.round((Date.now() - started) / 1000)}s\n`,
  );
} finally {
  clearInterval(heartbeat);
  audit.stop();
  await browser?.close();
  if (web?.pid && web.exitCode === null && web.signalCode === null) {
    const exited = once(web, "exit");
    process.kill(-web.pid, "SIGTERM");
    await exited;
  }
  await stopDaemon();
  await fixture.close();
  for (const signal of signals) process.removeListener(signal, interrupt);
}
