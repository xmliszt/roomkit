import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatSendResultSchema } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { z } from "zod";
import { verifyChatItemRefs } from "../packages/daemon/src/chat/verify-chat-item-refs.ts";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

await verifyChatItemRefs();
process.stdout.write("gate:b14: item references passed for Claude and Codex\n");
const fixture = await createReconFixture();
const heartbeat = setInterval(
  () =>
    process.stdout.write("gate:b14: checking concurrent generation and chat\n"),
  5000,
);
try {
  const blender = join(fixture.root, "fake-blender");
  writeFileSync(blender, '#!/bin/sh\necho "Blender 5.0.0"\n', { mode: 0o755 });
  fixture.env.BLENDER = blender;
  fixture.env.B10_CALLS = join(fixture.root, "modeler-calls.jsonl");
  fixture.env.B10_CONTROL = join(fixture.root, "generation-control.json");
  writeJson({ path: fixture.env.B10_CONTROL, value: { pause: true } });
  let daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Slots",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const response = await fetch(
    `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=reference.png&origin=chat`,
    {
      method: "POST",
      headers: { origin: fixture.origin },
      body: readFileSync("packages/daemon/catalog/charging-port/thumb.png"),
    },
  );
  assert.equal(response.status, 201);
  const { photoId } = PhotoUploadResultSchema.parse(await response.json());
  const items = Array.from(
    { length: 3 },
    () =>
      ({
        id: randomUUID(),
        name: "Resume",
        model: { kind: "pending", jobId: randomUUID() },
        locked: false,
        sizeM: { width: 1, depth: 0.5, height: 0.5 },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      }) satisfies Item,
  );
  for (const item of items)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "item.add", item },
    });
  await daemon.stop();
  const records = items.map((item) =>
    GenerationRecordSchema.parse({
      job: {
        id: item.model.jobId,
        kind: "generation",
        projectId: project.id,
        itemId: item.id,
        stage: "queued",
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      item,
      source: { kind: "photo", photoId },
      prompt: "Wait for the gate",
      held: false,
      attempt: 0,
      assetId: randomUUID(),
    }),
  );
  const jobsPath = join(
    fixture.root,
    "projects",
    project.id,
    ".planner",
    "jobs.json",
  );
  writeJson({ path: jobsPath, value: records });
  daemon = await fixture.start();
  function modelerCalls() {
    return existsSync(fixture.env.B10_CALLS ?? "")
      ? readFileSync(fixture.env.B10_CALLS ?? "", "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
      : [];
  }
  await daemon.waitFor({
    label: "two modeler CLIs running",
    read: () => (modelerCalls().length === 2 ? true : undefined),
  });
  const startedAt = Date.now();
  const sent = ChatSendResultSchema.parse(
    await daemon.command({
      type: "chat.send",
      projectId: project.id,
      text: "[fake:sleep] Reply while both modelers work",
    }),
  );
  const sessionPath = join(
    fixture.root,
    "projects",
    project.id,
    ".planner",
    "sessions",
    "designer-1.json",
  );
  await daemon.waitFor({
    label: "designer starts within five seconds",
    timeoutMs: 5000,
    read: () => {
      if (!existsSync(sessionPath)) return undefined;
      const session = z
        .object({ status: z.string(), pid: z.number().optional() })
        .parse(JSON.parse(readFileSync(sessionPath, "utf8")));
      return session.status === "running" && session.pid ? true : undefined;
    },
  });
  assert.ok(Date.now() - startedAt < 5000);
  assert.equal(modelerCalls().length, 2);
  for (const line of modelerCalls())
    process.kill(z.object({ pid: z.number() }).parse(JSON.parse(line)).pid, 0);
  assert.ok(sent.agentMessageId);
  const queued = items.at(2);
  const running = items.at(0);
  assert.ok(queued && running);
  const cancelled = await daemon.command({
    type: "job.cancel",
    projectId: project.id,
    jobId: queued.model.jobId,
  });
  assert.deepEqual(cancelled, { jobId: queued.model.jobId, stage: "held" });
  const saved = z
    .array(GenerationRecordSchema)
    .parse(JSON.parse(readFileSync(jobsPath, "utf8")))
    .find((record) => record.job.id === queued.model.jobId);
  assert.equal(saved?.held, true);
  const heldProject = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(
    heldProject.scene.items.find((item) => item.id === queued.id)?.model,
    queued.model,
  );
  const requestId = randomUUID();
  daemon.socket.send(
    JSON.stringify({
      type: "job.cancel",
      requestId,
      projectId: project.id,
      jobId: running.model.jobId,
    }),
  );
  const refused = CommandAckSchema.parse(
    await daemon.waitFor({
      label: "running cancel refusal",
      read: () =>
        daemon.frames.find(
          (frame) =>
            frame.type === "command.ack" && frame.requestId === requestId,
        ),
    }),
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error, /running|queued/i);
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.remove", itemId: running.id },
  });
  await daemon.command({
    type: "generation.start",
    projectId: project.id,
    itemId: queued.id,
  });
  await daemon.waitFor({
    label: "held generation starts again",
    read: () => (modelerCalls().length === 3 ? true : undefined),
  });
  await daemon.command({ type: "chat.stop", projectId: project.id });
  await daemon.stop();
  process.stdout.write(
    "gate:b14 passed: references, cross-project refusal, 2 modelers + designer within 5 s, queued cancel held and resumed, running cancel refused\n",
  );
} finally {
  clearInterval(heartbeat);
  await fixture.close();
}
