#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ChatMessageSchema } from "@planner/shared/src/chat/chat-message-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const args = parseArgs({
  allowPositionals: true,
  options: {
    "photo-id": { type: "string" },
    "asset-id": { type: "string" },
    "item-prefix": { type: "string" },
  },
});
const { source, sourcePhotoId, sourceAssetId, itemPrefix } = z
  .object({
    source: z.string().min(1),
    sourcePhotoId: z.guid(),
    sourceAssetId: z.string().min(1),
    itemPrefix: z.string().min(1),
  })
  .parse({
    source: args.positionals.at(0),
    sourcePhotoId: args.values["photo-id"],
    sourceAssetId: args.values["asset-id"],
    itemPrefix: args.values["item-prefix"],
  });

const started: { interrupt: () => Promise<unknown> }[] = [];
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => {
    Promise.all(started.map((replay) => replay.interrupt())).finally(() =>
      process.exit(130),
    );
  });

function startReplay() {
  const child = spawn(
    process.execPath,
    [
      "scripts/demo/replay.ts",
      source,
      "--piece-seconds",
      "1",
      "--recon-seconds",
      "3",
      "--hold-item",
      itemPrefix,
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
      if (match) return match;
      assert.equal(child.exitCode, null, `Replay exited early:\n${output}`);
      assert.ok(Date.now() < deadline, `Timed out waiting for ${pattern}`);
      await delay(100);
    }
  }
  async function interrupt() {
    if (child.exitCode !== null || child.signalCode !== null)
      return { code: child.exitCode };
    const exited = once(child, "exit");
    process.kill(-(child.pid ?? 0), "SIGINT");
    const stopped = await Promise.race([
      exited,
      delay(120_000, undefined, { ref: false }),
    ]);
    if (stopped) return { code: child.exitCode };
    process.kill(-(child.pid ?? 0), "SIGKILL");
    await exited;
    throw new Error("Replay did not stop within 120 s after SIGINT");
  }
  const replay = { child, waitForLine, interrupt };
  started.push(replay);
  return replay;
}

async function assertStopped(options: { root: string; ports: string[] }) {
  const pids = readFileSync(join(options.root, "processes.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => z.object({ pid: z.number() }).parse(JSON.parse(line)).pid);
  const alive = pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(alive, [], "Replay processes still running");
  for (const port of options.ports) {
    const server = createServer().listen(Number(port), "127.0.0.1");
    await once(server, "listening");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return pids.length;
}

async function main() {
  const replay = startReplay();
  const root = (await replay.waitForLine(/Replay data: (.+)\n/)).at(1) ?? "";
  const url = new URL(
    (await replay.waitForLine(/Project URL: (.+)\n/)).at(1) ?? "",
  );
  const daemonPort = (await replay.waitForLine(/Daemon port: (\d+)\n/)).at(1);
  const projectId = url.pathname.split("/").at(-1) ?? "";
  await replay.waitForLine(/Replay complete\./);
  const origin = `http://localhost:${url.port}`;
  const base = `http://127.0.0.1:${daemonPort}/projects/${projectId}`;
  const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`, {
    headers: { origin },
  });
  const frames: z.infer<typeof ServerMessageSchema>[] = [];
  socket.on("message", (data) =>
    frames.push(ServerMessageSchema.parse(JSON.parse(data.toString()))),
  );
  await once(socket, "open");
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = randomUUID();
    socket.send(JSON.stringify({ ...request, requestId }));
    while (true) {
      const frame = frames.find(
        (frame) =>
          frame.type === "command.ack" && frame.requestId === requestId,
      );
      if (frame) {
        const ack = CommandAckSchema.parse(frame);
        assert.ok(ack.ok, ack.ok ? "" : ack.error);
        return ack.result;
      }
      await delay(50);
    }
  }
  const chat = ChatMessageSchema.array().parse(
    JSON.parse(readFileSync(join(root, "source", "chat.json"), "utf8")),
  );
  const request = chat.findLast((message) =>
    message.blocks.some(
      (block) => block.kind === "image" && block.photoId === sourcePhotoId,
    ),
  );
  const text = request?.blocks.find((block) => block.kind === "text");
  assert.ok(text?.kind === "text");
  const upload = await fetch(
    `${base}/photos?origin=chat&fileName=${sourcePhotoId}.png`,
    {
      method: "POST",
      headers: { origin },
      body: readFileSync(
        join(root, "source", "photos", `${sourcePhotoId}.png`),
      ),
    },
  );
  assert.equal(upload.status, 201, await upload.clone().text());
  const photo = PhotoUploadResultSchema.parse(await upload.json());
  assert.notEqual(photo.photoId, sourcePhotoId);
  await command({
    type: "chat.send",
    projectId,
    text: text.markdown,
    photoIds: [photo.photoId],
  });
  const deadline = Date.now() + 180_000;
  let project: z.infer<typeof ProjectSchema>;
  while (true) {
    assert.ok(Date.now() < deadline, "The chat lamp was not placed");
    const failed = frames.flatMap((frame) =>
      frame.type === "event" &&
      frame.event.kind === "job.updated" &&
      frame.event.job.stage === "failed"
        ? [frame.event.job]
        : [],
    );
    assert.deepEqual(failed, [], "A job failed");
    project = ProjectSchema.parse(
      await command({ type: "project.open", projectId }),
    );
    const lamp = project.scene.items.find((item) =>
      item.name.startsWith(itemPrefix),
    );
    if (lamp?.model.kind === "asset") {
      assert.deepEqual(
        readFileSync(
          join(
            root,
            "projects",
            projectId,
            "assets",
            lamp.model.assetId,
            "model.glb",
          ),
        ),
        readFileSync(
          join(root, "source", "assets", sourceAssetId, "model.glb"),
        ),
        "The chat lamp is not the saved lamp model",
      );
      break;
    }
    await delay(500);
  }
  const sourceEntries = z
    .object({ entries: z.array(z.object({ item: ItemSchema })) })
    .parse(
      JSON.parse(readFileSync(join(root, "source", "replay.json"), "utf8")),
    ).entries;
  assert.equal(project.scene.items.length, sourceEntries.length);
  const sourceLamp = sourceEntries.find((entry) =>
    entry.item.name.startsWith(itemPrefix),
  )?.item;
  const expected = sourceLamp?.placement;
  const actual = project.scene.items.find((item) =>
    item.name.startsWith(itemPrefix),
  )?.placement;
  assert.ok(expected && actual, "Missing source or replay item placement");
  const actualFields = Object.fromEntries(Object.entries(actual));
  for (const [key, value] of Object.entries(expected)) {
    const field = actualFields[key];
    if (typeof value === "number" && typeof field === "number") {
      assert.ok(
        Math.abs(field - value) <= 0.001,
        `Placement changed at ${key}`,
      );
    } else {
      assert.deepEqual(field, value, `Placement changed at ${key}`);
    }
  }
  const room = z
    .object({ pointsPath: z.string() })
    .parse(
      JSON.parse(
        readFileSync(
          join(root, "projects", projectId, "recon", "room.json"),
          "utf8",
        ),
      ),
    );
  assert.equal(
    statSync(join(root, "projects", projectId, "recon", room.pointsPath)).size,
    8000 * 6 * 4,
    "Replay has no sampled points.bin",
  );
  const snapshot = await fetch(`${base}/snapshots`, {
    method: "POST",
    headers: { origin },
    body: readFileSync(join(root, "final.png")),
  });
  assert.equal(snapshot.status, 201, await snapshot.clone().text());
  assert.equal(
    readdirSync(join(root, "projects", projectId, "snapshots")).filter((name) =>
      name.endsWith(".png"),
    ).length,
    1,
  );
  socket.close();
  const stopped = await replay.interrupt();
  assert.equal(stopped.code, 0, "Replay did not stop cleanly");
  const result = z
    .object({
      items: z.number(),
      failedJobs: z.array(z.unknown()),
      processAudit: z.object({ violations: z.array(z.string()) }),
    })
    .parse(JSON.parse(readFileSync(join(root, "result.json"), "utf8")));
  assert.equal(result.items, 45);
  assert.deepEqual(result.failedJobs, []);
  assert.deepEqual(result.processAudit.violations, []);
  const calls = readFileSync(join(root, "calls.jsonl"), "utf8");
  assert.ok(calls.includes('"kind":"designer"'), "No designer turn replayed");
  const observed = await assertStopped({
    root,
    ports: [url.port, daemonPort ?? ""],
  });

  const early = startReplay();
  const earlyRoot =
    (await early.waitForLine(/Replay data: (.+)\n/)).at(1) ?? "";
  const earlyUrl = new URL(
    (await early.waitForLine(/Project URL: (.+)\n/)).at(1) ?? "",
  );
  const earlyDaemonPort = (await early.waitForLine(/Daemon port: (\d+)\n/)).at(
    1,
  );
  await delay(3000);
  await early.interrupt();
  assert.ok(
    existsSync(join(earlyRoot, "processes.jsonl")),
    "Interrupted replay has no process log",
  );
  const earlyObserved = await assertStopped({
    root: earlyRoot,
    ports: [earlyUrl.port, earlyDaemonPort ?? ""],
  });
  process.stdout.write(
    `gate:b24 passed: 45 items after the chat lamp, lamp at its source placement within 1 mm, no failed jobs, process audit clean, snapshot saved; ${observed} replay processes stopped on SIGINT; mid-run SIGINT stopped ${earlyObserved} processes\n`,
  );
}

try {
  await main();
} finally {
  for (const replay of started) await replay.interrupt();
}
