#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
import type { z } from "zod";

const source = process.argv.at(2);
assert.ok(
  source,
  "Usage: scripts/demo/verify-replay-real-render.ts <project-folder>",
);
const evidence = resolve("docs/work-packages/evidence/b29-replay-real-render");
mkdirSync(evidence, { recursive: true });
const capture = join(mkdtempSync(join(tmpdir(), "planner-b29-")), "capture");
const photo = join(evidence, "render.png");
const sourceBefore = readFileSync(join(source, "project.json"));
const sharp: typeof import("../../packages/daemon/node_modules/sharp/lib/index.js") =
  createRequire(new URL("../../packages/daemon/package.json", import.meta.url))(
    "sharp",
  );

async function runScript(args: string[]) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, args.join(" "));
}

async function replay(options: { image?: string }) {
  const child = spawn(
    process.execPath,
    [
      "scripts/demo/replay.ts",
      source ?? "",
      "--piece-seconds",
      "1",
      "--recon-seconds",
      "3",
      ...(options.image ? ["--render-image", options.image] : []),
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
  async function waitForLine(pattern: RegExp) {
    const deadline = Date.now() + 600_000;
    while (true) {
      const match = pattern.exec(output);
      if (match) return match.at(1) ?? "";
      assert.equal(child.exitCode, null, output);
      assert.ok(Date.now() < deadline, `Timed out: ${pattern}`);
      await delay(100);
    }
  }
  let stopping: Promise<void> | undefined;
  function stop() {
    stopping ??= stopReplay();
    return stopping;
  }
  async function stopReplay() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    assert.ok(child.pid);
    process.kill(-child.pid, "SIGINT");
    if (
      !(await Promise.race([exited, delay(120_000, undefined, { ref: false })]))
    ) {
      process.kill(-child.pid, "SIGKILL");
      await exited;
      throw new Error("Replay did not stop within 120 s");
    }
    assert.equal(child.exitCode, 0, output);
  }
  function interrupt() {
    void stop();
  }
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let socket: WebSocket | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const root = await waitForLine(/Replay data: (.+)\n/);
    const url = await waitForLine(/Project URL: (.+)\n/);
    const port = await waitForLine(/Daemon port: (\d+)\n/);
    assert.ok(!["3210", "4820"].includes(port));
    assert.ok(!["3210", "4820"].includes(new URL(url).port));
    await waitForLine(/(Replay complete)\./);
    const projectId = new URL(url).pathname.split("/").at(-1);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { origin: new URL(url).origin },
    });
    const frames: z.infer<typeof ServerMessageSchema>[] = [];
    socket.on("message", (data) =>
      frames.push(ServerMessageSchema.parse(JSON.parse(data.toString()))),
    );
    await once(socket, "open");
    async function command(request: { type: string; [key: string]: unknown }) {
      const requestId = crypto.randomUUID();
      socket?.send(JSON.stringify({ ...request, projectId, requestId }));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const ack = frames.find(
          (frame) =>
            frame.type === "command.ack" && frame.requestId === requestId,
        );
        if (ack?.type === "command.ack") {
          assert.ok(ack.ok, ack.ok ? "" : ack.error);
          return ack.result;
        }
        await delay(20);
      }
      throw new Error(`Command timed out: ${request.type}`);
    }
    const project = ProjectSchema.parse(
      await command({ type: "project.open" }),
    );
    const sofa = project.scene.items.find((item) =>
      /^Sofa \(2-seat/i.test(item.name),
    );
    assert.ok(sofa, "No sofa in replay");
    const colorAdjust = { kind: "colorize", color: "#166534", strength: 1 };
    assert.notDeepEqual(sofa.colorAdjust, colorAdjust);
    await command({
      type: "scene.apply",
      command: { type: "item.update", itemId: sofa.id, patch: { colorAdjust } },
    });
    const lamps = project.scene.items.filter((item) => item.light);
    assert.ok(lamps.length > 0, "No lamps in replay");
    for (const item of lamps)
      await command({
        type: "scene.apply",
        command: {
          type: "item.update",
          itemId: item.id,
          patch: { light: { ...item.light, on: true } },
        },
      });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await page.goto(url);
    await page.getByRole("button", { name: "Snapshot", exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-load-in-stage]").length > 0 &&
        document.querySelectorAll(
          '[data-load-in-stage="loading"], [data-load-in-stage="appearing"]',
        ).length === 0,
      undefined,
      { timeout: 120000 },
    );
    await delay(1000);
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Snapshot photo" });
    const snapshot = modal.getByRole("img", {
      name: "Snapshot of the room",
      exact: true,
    });
    await snapshot.evaluate(async (element) => {
      assertImage(element);
      await element.decode();
      function assertImage(value: Element): asserts value is HTMLImageElement {
        if (!(value instanceof HTMLImageElement))
          throw new Error("No snapshot image");
      }
    });
    const snapshotBytes = await snapshot.evaluate(async (element) => {
      if (!(element instanceof HTMLImageElement))
        throw new Error("No snapshot image");
      return Array.from(
        new Uint8Array(await (await fetch(element.src)).arrayBuffer()),
      );
    });
    if (!options.image)
      writeFileSync(join(evidence, "snapshot.png"), Buffer.from(snapshotBytes));
    await modal
      .getByRole("button", { name: "Render realistic photo", exact: true })
      .click();
    await modal
      .getByText("The photo is ready in chat.", { exact: true })
      .waitFor({ timeout: 60000 });
    const image = modal.getByRole("img", {
      name: "Rendered photo of the room",
      exact: true,
    });
    const rendered = await image.evaluate(async (element) => {
      if (!(element instanceof HTMLImageElement))
        throw new Error("No rendered image");
      await element.decode();
      return Array.from(
        new Uint8Array(
          await (await fetch(element.src, { mode: "cors" })).arrayBuffer(),
        ),
      );
    });
    const job = frames
      .flatMap((frame) =>
        frame.type === "event" &&
        frame.event.kind === "job.updated" &&
        frame.event.job.kind === "render"
          ? [frame.event.job]
          : [],
      )
      .findLast((job) => job.stage === "done");
    assert.ok(job, "Render job did not finish");
    const folder = join(root, "projects", project.id);
    if (!options.image) {
      await runScript([
        "scripts/demo/capture-replay-state.ts",
        folder,
        job.id,
        capture,
      ]);
    } else {
      assert.deepEqual(
        Buffer.from(rendered),
        readFileSync(photo),
        "Modal must show supplied render bytes",
      );
      const original = JSON.parse(
        readFileSync(join(capture, "render-view.json"), "utf8"),
      );
      const second = JSON.parse(
        readFileSync(
          join(folder, ".planner/render", job.id, "scene.json"),
          "utf8",
        ),
      );
      assert.deepEqual(second.view, original, "Second replay camera differs");
      await page.screenshot({ path: join(evidence, "modal.png") });
    }
    socket.close();
    await browser.close();
    await stop();
    const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
    assert.deepEqual(result.failedJobs, []);
    assert.deepEqual(result.processAudit.violations, []);
    return {
      root,
      port,
      url,
      jobId: job.id,
      processAudit: result.processAudit,
      sofa: sofa.name,
      colorAdjust,
      lamps: lamps.length,
    };
  } finally {
    socket?.close();
    await browser?.close();
    await stop();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

const first = await replay({});
await runScript([
  "scripts/demo/render-replay-state.ts",
  join(capture, "project"),
  join(capture, "render-view.json"),
  photo,
]);
const second = await replay({ image: photo });
assert.deepEqual(
  readFileSync(join(source, "project.json")),
  sourceBefore,
  "Source project changed",
);
const images = await Promise.all(
  ["snapshot.png", "render.png"].map((name) =>
    sharp(join(evidence, name))
      .resize({
        width: 960,
        height: 720,
        fit: "contain",
        background: "#ffffff",
      })
      .png()
      .toBuffer(),
  ),
);
await sharp({
  create: { width: 1920, height: 720, channels: 3, background: "#ffffff" },
})
  .composite(
    images.map((input, index) => ({ input, left: index * 960, top: 0 })),
  )
  .png()
  .toFile(join(evidence, "side-by-side.png"));
writeFileSync(
  join(evidence, "result.json"),
  `${JSON.stringify({ first, second, renderSha256: createHash("sha256").update(readFileSync(photo)).digest("hex"), sourceUnchanged: true, modalBytesMatch: true, viewMatches: true, metrics: JSON.parse(readFileSync(`${photo}.json`, "utf8")) }, null, 2)}\n`,
);
process.stdout.write(
  "gate:b29 passed: changed sofa colour, lamps on, captured snapshot scene/view, real Blender render, supplied PNG decoded in second replay modal, identical bytes/view, both process audits clean, source unchanged\n",
);
