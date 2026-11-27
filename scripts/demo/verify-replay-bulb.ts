#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
import { z } from "zod";

const LAMP_PREFIX = "Table lamp (mushroom";
const SAVED_EMITTER = { x: 0.5, y: 0.62, z: 0.5 };
const args = parseArgs({ allowPositionals: true });
const source = args.positionals.at(0);
assert.ok(source, "Usage: scripts/demo/verify-replay-bulb.ts <project-folder>");

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
  const projectId = new URL(url).pathname.split("/").at(-1) ?? "";
  await waitForLine(/(Replay complete)\./);
  const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`, {
    headers: { origin: new URL(url).origin },
  });
  const frames: z.infer<typeof ServerMessageSchema>[] = [];
  socket.on("message", (data) =>
    frames.push(ServerMessageSchema.parse(JSON.parse(data.toString()))),
  );
  await once(socket, "open");
  async function openProject() {
    const requestId = randomUUID();
    socket.send(JSON.stringify({ type: "project.open", projectId, requestId }));
    while (true) {
      const frame = frames.find(
        (frame) =>
          frame.type === "command.ack" && frame.requestId === requestId,
      );
      if (frame) {
        const ack = CommandAckSchema.parse(frame);
        assert.ok(ack.ok, ack.ok ? "" : ack.error);
        return ProjectSchema.parse(ack.result);
      }
      await delay(50);
    }
  }
  const before = (await openProject()).scene.items.find((item) =>
    item.name.startsWith(LAMP_PREFIX),
  );
  assert.ok(before, "No mushroom lamp in the replay");
  assert.equal(before.light, undefined, "The lamp already has a light");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(url);
    await page.getByRole("button", { name: /^chat/ }).click();
    await page.getByRole("tab", { name: "Objects" }).click();
    await page
      .locator("button[aria-expanded]", { hasText: LAMP_PREFIX })
      .click();
    await page.getByRole("button", { name: /^chat/ }).click();
    await page.getByRole("switch", { name: "Light source" }).check();
    await page
      .getByRole("switch", { name: "on", exact: true })
      .waitFor({ state: "visible" });
  } finally {
    await browser.close();
  }

  const deadline = Date.now() + 60_000;
  while (true) {
    assert.ok(Date.now() < deadline, "The bulb job did not finish");
    const jobs = Object.values(
      Object.fromEntries(
        frames.flatMap((frame) =>
          frame.type === "event" && frame.event.kind === "job.updated"
            ? [[frame.event.job.id, frame.event.job]]
            : [],
        ),
      ),
    );
    assert.deepEqual(
      jobs.filter((job) => job.stage === "failed"),
      [],
      "A job failed",
    );
    const bulb = jobs.find(
      (job) => job.kind === "bulb" && job.itemId === before.id,
    );
    if (bulb?.stage === "done") {
      assert.equal(bulb.lastLogLine, "placed the bulb");
      break;
    }
    await delay(200);
  }
  const lamp = (await openProject()).scene.items.find(
    (item) => item.id === before.id,
  );
  assert.equal(lamp?.light?.on, true, "The lamp light is not on");
  assert.deepEqual(
    lamp.light.emitter,
    SAVED_EMITTER,
    "The bulb is not at the saved position",
  );
  socket.close();

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
  assert.deepEqual(
    calls.filter((call) => call.kind === "thumbnail").map((call) => call.view),
    ["front", "side"],
  );
  assert.deepEqual(
    calls.filter((call) => call.kind === "bulb").map((call) => call.saved),
    [true],
  );
  process.stdout.write(
    `gate:b25 passed: bulb job done ("placed the bulb"), lamp light on at the saved bulb position ${JSON.stringify(SAVED_EMITTER)}, no failed jobs, process audit clean\n`,
  );
}

try {
  await main();
} finally {
  await interrupt();
}
