import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { z } from "zod";
import { readProcessIdentity } from "../packages/daemon/src/jobs/read-process-identity.ts";
import { readPhotos } from "../packages/daemon/src/photos/read-photos.ts";
import { JobRecordSchema } from "../packages/daemon/src/reconstruction/job-record-schema.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture();
try {
  let daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "B6",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const folder = join(fixture.root, "projects", project.id);
  const source = readFileSync(
    new URL("../packages/daemon/test/fixtures/oriented.heic", import.meta.url),
  );
  async function upload(origin: "capture" | "chat") {
    const response = await fetch(
      `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=room.heic&origin=${origin}`,
      { method: "POST", headers: { origin: fixture.origin }, body: source },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return PhotoUploadResultSchema.parse(await response.json()).photoId;
  }
  const captures: string[] = [];
  for (let index = 0; index < 4; index++)
    captures.push(await upload("capture"));
  await upload("chat");
  const chat = readPhotos(folder).find((photo) => photo.origin === "chat");
  async function start() {
    return z.object({ jobId: z.string() }).parse(
      await daemon.command({
        type: "reconstruction.start",
        projectId: project.id,
      }),
    ).jobId;
  }
  async function finish(jobId: string) {
    return daemon.waitFor({
      label: `job ${jobId}`,
      read: () =>
        daemon.frames
          .flatMap((frame) => {
            const jobs =
              frame.type === "snapshot"
                ? frame.jobs
                : frame.type === "event" && frame.event.kind === "job.updated"
                  ? [frame.event.job]
                  : [];
            return jobs.filter(
              (job) =>
                job.id === jobId &&
                (job.stage === "done" || job.stage === "failed"),
            );
          })
          .at(-1),
    });
  }
  async function opened() {
    return ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
  }
  fixture.control({ mode: "pause-intake", rejectFirst: true });
  const first = await start();
  await daemon.waitFor({
    label: "intake",
    read: () =>
      existsSync(join(fixture.root, "calls.jsonl")) ? true : undefined,
  });
  await upload("chat");
  const laterCapture = await upload("capture");
  fixture.control({ mode: "normal" });
  assert.equal((await finish(first)).stage, "done");
  const calls = readFileSync(join(fixture.root, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) =>
      z
        .object({
          worker: z.string(),
          request: z.record(z.string(), z.unknown()),
          pid: z.number(),
        })
        .parse(JSON.parse(line)),
    );
  const intake = calls.find((call) => call.worker === "intake");
  assert.deepEqual(
    z
      .array(z.object({ photoId: z.string() }))
      .parse(intake?.request.photos)
      .map((photo) => photo.photoId),
    captures,
  );
  const geometry = calls.find((call) => call.worker === "reconstruct");
  const manifest = z
    .object({
      photos: z.array(z.object({ photoId: z.string(), kind: z.string() })),
    })
    .parse(
      JSON.parse(
        readFileSync(z.string().parse(geometry?.request.photosPath), "utf8"),
      ),
    );
  assert.deepEqual(
    manifest.photos.map((photo) => photo.photoId),
    captures,
  );
  assert.equal(
    manifest.photos.filter((photo) => photo.kind === "accepted").length,
    3,
  );
  assert.deepEqual(
    readPhotos(folder).find((photo) => photo.photoId === chat?.photoId),
    chat,
  );
  assert.equal(
    readPhotos(folder).filter((photo) => photo.origin === "chat").length,
    2,
  );
  assert.ok(readPhotos(folder).some((photo) => photo.photoId === laterCapture));
  const stages = daemon.frames.flatMap((frame) =>
    frame.type === "event" &&
    frame.event.kind === "job.updated" &&
    frame.event.job.id === first
      ? [frame.event.job.stage]
      : [],
  );
  for (const stage of [
    "queued",
    "intake",
    "geometry",
    "layout",
    "coverage",
    "done",
  ])
    assert.ok(
      stages.some((received) => received === stage),
      `missing ${stage}`,
    );
  const changes = daemon.frames.filter(
    (frame) => frame.type === "event" && frame.event.kind === "scene.changed",
  );
  assert.equal(changes.length, 1);
  const result = await opened();
  assert.equal(result.scene.room.ceilingHeightM, 2.7);
  assert.equal(result.reconstruction?.weakScale, true);
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  const message = history.messages.find((message) => message.id === first);
  assert.equal(
    message?.blocks.filter((block) => block.kind === "capture-request").length,
    2,
  );
  const diff = message?.blocks.find((block) => block.kind === "diff");
  assert.ok(diff?.kind === "diff");
  for (const command of diff.undo)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  assert.deepEqual((await opened()).scene, project.scene);
  const photoId = captures.at(1);
  assert.ok(photoId);
  await daemon.command({
    type: "reconstruction.scale.set",
    projectId: project.id,
    sources: [
      {
        kind: "furniture",
        photoId,
        box: [0, 0, 50, 50],
        axis: "height",
        lengthM: 1.2,
        floorStanding: true,
      },
    ],
  });
  await daemon.waitFor({
    label: "undo persisted",
    read: () =>
      ProjectSchema.parse(
        JSON.parse(readFileSync(join(folder, "project.json"), "utf8")),
      ).revision === 2
        ? true
        : undefined,
  });
  fixture.control({ mode: "pause" });
  const resumed = await start();
  await daemon.waitFor({
    label: "paused geometry",
    read: () =>
      daemon.frames.find(
        (frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.id === resumed &&
          frame.event.job.stage === "geometry" &&
          frame.event.job.progress > 0.2,
      ),
  });
  const processRecord = z
    .object({ pid: z.number() })
    .parse(
      JSON.parse(
        readFileSync(join(fixture.root, "home", "python-worker.json"), "utf8"),
      ),
    );
  await daemon.stop("SIGKILL");
  assert.ok(readProcessIdentity(processRecord.pid));
  fixture.control({ mode: "normal", disagreement: true });
  daemon = await fixture.start();
  assert.equal((await finish(resumed)).stage, "done");
  assert.equal(readProcessIdentity(processRecord.pid), undefined);
  const afterRestart = await opened();
  assert.equal(afterRestart.reconstruction?.weakScale, false);
  assert.deepEqual(
    afterRestart.scene.room.walls.map((wall) => wall.id),
    result.scene.room.walls.map((wall) => wall.id),
  );
  assert.equal(afterRestart.revision, 3);
  await daemon.stop();
  const jobsPath = join(folder, ".planner", "jobs.json");
  const jobs = z
    .array(
      z
        .object({ job: z.object({ id: z.string() }).passthrough() })
        .passthrough(),
    )
    .parse(JSON.parse(readFileSync(jobsPath, "utf8")));
  writeJson({
    path: jobsPath,
    value: jobs.map((record) =>
      record.job.id === resumed
        ? {
            ...JobRecordSchema.parse(record),
            job: { ...record.job, stage: "coverage", progress: 0.95 },
          }
        : record,
    ),
  });
  daemon = await fixture.start();
  assert.equal((await finish(resumed)).stage, "done");
  assert.deepEqual(
    await opened(),
    afterRestart,
    "Prepared outcome applied the room twice",
  );
  const replayHistory = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  assert.equal(
    replayHistory.messages.filter((message) => message.id === resumed).length,
    1,
  );
  fixture.control({ mode: "fail" });
  const failed = await start();
  assert.equal((await finish(failed)).stage, "failed");
  assert.deepEqual(await opened(), afterRestart);
  const failedHistory = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  assert.ok(
    failedHistory.messages
      .find((message) => message.id === failed)
      ?.blocks.some(
        (block) =>
          block.kind === "notice" &&
          block.text.includes("synthetic geometry failure"),
      ),
  );
  await daemon.stop();
  process.stdout.write(
    "gate:b6 passed: capture-only intake, concurrent uploads preserved, stages, one undoable room update, scale segmentation, SIGKILL restart, orphan kill, stable walls, failure notice\n",
  );
} finally {
  await fixture.close();
}
