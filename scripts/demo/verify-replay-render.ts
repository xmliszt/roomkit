#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
import { z } from "zod";

const args = parseArgs({ allowPositionals: true });
const source = args.positionals.at(0);
assert.ok(
  source,
  "Usage: scripts/demo/verify-replay-render.ts <project-folder>",
);

const child = spawn(
  process.execPath,
  [
    "scripts/demo/replay.ts",
    source,
    "--piece-seconds",
    "1",
    "--recon-seconds",
    "3",
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
    assert.equal(child.exitCode, null, `Replay exited early:\n${output}`);
    assert.ok(Date.now() < deadline, `Timed out waiting for ${pattern}`);
    await delay(100);
  }
}
async function interrupt() {
  if (child.exitCode !== null || child.signalCode !== null)
    return child.exitCode;
  const exited = once(child, "exit");
  process.kill(-(child.pid ?? 0), "SIGINT");
  const stopped = await Promise.race([
    exited,
    delay(120_000, undefined, { ref: false }),
  ]);
  if (stopped) return child.exitCode;
  process.kill(-(child.pid ?? 0), "SIGKILL");
  await exited;
  throw new Error("Replay did not stop within 120 s after SIGINT");
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => {
    interrupt().finally(() => process.exit(130));
  });

async function main() {
  const root = await waitForLine(/Replay data: (.+)\n/);
  const url = await waitForLine(/Project URL: (.+)\n/);
  const daemonPort = await waitForLine(/Daemon port: (\d+)\n/);
  await waitForLine(/(Replay complete)\./);
  const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`, {
    headers: { origin: new URL(url).origin },
  });
  const frames: z.infer<typeof ServerMessageSchema>[] = [];
  socket.on("message", (data) =>
    frames.push(ServerMessageSchema.parse(JSON.parse(data.toString()))),
  );
  await once(socket, "open");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(url);
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Snapshot photo" });
    await modal
      .getByRole("button", { name: "Render realistic photo", exact: true })
      .click();
    await modal.getByRole("button", { name: /^Rendering/ }).waitFor();
    await modal
      .getByText("The photo is ready in chat.", { exact: true })
      .waitFor({ timeout: 60000 });
    const image = modal.getByRole("img", {
      name: "Rendered photo of the room",
      exact: true,
    });
    await image.waitFor();
    await image.evaluate(async (element) => {
      if (!(element instanceof HTMLImageElement))
        throw new Error("No rendered image");
      await element.decode();
    });
    const render = frames
      .flatMap((frame) =>
        frame.type === "event" && frame.event.kind === "job.updated"
          ? [frame.event.job]
          : [],
      )
      .findLast((job) => job.kind === "render");
    assert.equal(render?.stage, "done", "Render job is not ready");
    assert.ok(
      frames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.kind === "render" &&
          frame.event.job.stage === "rendering" &&
          frame.event.job.progress > 0,
      ),
      "No render progress",
    );
    mkdirSync("docs/work-packages/evidence/b28-replay-render", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/work-packages/evidence/b28-replay-render/render.png",
    });
  } finally {
    await browser.close();
    socket.close();
  }

  assert.equal(await interrupt(), 0, "Replay did not stop cleanly");
  const result = z
    .object({
      failedJobs: z.array(z.unknown()),
      processAudit: z.object({ violations: z.array(z.string()) }),
    })
    .parse(JSON.parse(readFileSync(join(root, "result.json"), "utf8")));
  assert.deepEqual(result.failedJobs, []);
  assert.deepEqual(result.processAudit.violations, []);
  const calls = readFileSync(join(root, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) =>
      z
        .object({
          kind: z.string(),
          view: z.string().optional(),
          saved: z.boolean().optional(),
        })
        .parse(JSON.parse(line)),
    );
  assert.equal(calls.filter((call) => call.kind === "render").length, 1);
  process.stdout.write(
    "gate:b28 passed: render job ready (done), progress reported, modal rendered image decoded, no failed jobs, process audit clean\n",
  );
}

try {
  await main();
} finally {
  await interrupt();
}
