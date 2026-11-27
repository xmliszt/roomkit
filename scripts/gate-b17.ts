import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { JobLogResultSchema } from "@planner/shared/src/protocol/job-log-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { z } from "zod";
import { GenerationRecordSchema } from "../packages/daemon/src/generation/generation-record-schema.ts";
import { stopProcessGroup } from "../packages/daemon/src/jobs/stop-process-group.ts";
import { runPythonWorker } from "../packages/daemon/src/python/run-python-worker.ts";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const fixture = await createReconFixture({
  env: {
    BLENDER:
      process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
    PLANNER_PYTHON_BIN: resolve(
      "packages/daemon/test/fixtures/timeout-python.mjs",
    ),
    PLANNER_PYTHON_TIMEOUT_MS: "60000",
    PLANNER_PYTHON_INACTIVITY_MS: "1500",
    B17_MODE: "stall",
  },
});
fixture.env.PLANNER_MACHINE_LOCK = join(fixture.root, "machine.lock");
fixture.env.B17_CALLS = join(fixture.root, "calls.jsonl");
const heartbeat = setInterval(
  () => process.stdout.write("gate:b17: waiting for fake workers\n"),
  5000,
);
let holderPid: number | undefined;
try {
  const holder = spawn(
    resolve("scripts/machine-lock.sh"),
    ["fake-holder", process.execPath, "-e", "setTimeout(() => {}, 120000)"],
    {
      env: fixture.env,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  holderPid = holder.pid;
  const holderExited = once(holder, "exit");
  const [acquired] = await once(holder.stderr, "data");
  assert.match(String(acquired), /machine-lock: acquired/);
  const progress: string[] = [];
  const startedMs = Date.now();
  await runPythonWorker({
    python: fixture.env.PLANNER_PYTHON_BIN ?? "",
    workersDir: resolve("python/workers"),
    worker: "generate_sam3d",
    machineLock: {
      path: resolve("scripts/machine-lock.sh"),
      label: "timing-test",
    },
    input: { outputDir: join(fixture.root, "timed-worker") },
    env: { ...fixture.env, B17_MODE: "normal", B17_RUN_MS: "60000" },
    signal: new AbortController().signal,
    timeoutMs: 90_000,
    processPath: join(fixture.root, "timing-process.json"),
    onLine() {},
    onProgress(frame) {
      progress.push(frame.stage);
    },
  });
  await holderExited;
  holderPid = undefined;
  assert.ok(
    Date.now() - startedMs >= 180_000,
    "must wait two minutes, then run one minute",
  );
  assert.deepEqual(progress, ["waiting", "generating"]);
  assert.equal(existsSync(fixture.env.PLANNER_MACHINE_LOCK), false);
  process.stdout.write(
    "gate:b17: 120-second lock wait + 60-second run passed under a 90-second run limit\n",
  );

  let daemon = await fixture.start();
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "Alternative timeout gate",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const item = {
    id: "port",
    name: "Port",
    model: { kind: "asset", assetId: CHARGING_PORT.assetId },
    placement: {
      kind: "wall",
      wallId: project.scene.room.walls.at(0)?.id ?? "",
      alongM: 1,
      heightM: 0.3,
      rotationRad: 0,
    },
    sizeM: CHARGING_PORT.sizeM,
    locked: false,
  };
  await daemon.command({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item },
  });
  const response = await fetch(
    `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=room.heic&origin=capture`,
    {
      method: "POST",
      headers: { origin: fixture.origin },
      body: readFileSync("packages/daemon/test/fixtures/oriented.heic"),
    },
  );
  assert.equal(response.status, 201);
  const { photoId } = PhotoUploadResultSchema.parse(await response.json());
  await daemon.stop();
  const now = new Date().toISOString();
  const folder = join(fixture.root, "projects", project.id);
  const record = GenerationRecordSchema.parse({
    job: {
      id: "original",
      kind: "generation",
      projectId: project.id,
      itemId: item.id,
      stage: "ready",
      lastLogLine: 'RESULT {"old":true}',
      progress: 1,
      createdAt: now,
      updatedAt: now,
    },
    item,
    source: { kind: "photo", photoId },
    prompt: "Port",
    held: false,
    attempt: 0,
    assetId: CHARGING_PORT.assetId,
  });
  writeJson({
    path: join(folder, ".planner/jobs.json"),
    value: [
      record,
      {
        ...record,
        job: { ...record.job, id: "status", lastLogLine: "Compared all views" },
      },
    ],
  });
  fixture.env.B11_ASSET = join(
    folder,
    "assets",
    CHARGING_PORT.assetId,
    "model.glb",
  );
  daemon = await fixture.start();
  assert.ok(
    daemon.frames.every(
      (frame) =>
        frame.type !== "snapshot" ||
        frame.jobs.every((job) => !job.lastLogLine?.includes("RESULT ")),
    ),
  );
  assert.match(
    readFileSync(
      join(folder, ".planner/generation/original/worker.log"),
      "utf8",
    ),
    /RESULT \{"old":true\}/,
  );
  function updatedJobs() {
    return daemon.frames.flatMap((frame) =>
      frame.type === "event" && frame.event.kind === "job.updated"
        ? [frame.event.job]
        : [],
    );
  }
  const { jobIds } = z.object({ jobIds: z.array(z.string()).length(2) }).parse(
    await daemon.command({
      type: "generation.alternatives",
      projectId: project.id,
      itemId: item.id,
    }),
  );
  const jobs = await Promise.all(
    jobIds.map((id) =>
      daemon.waitFor({
        label: `alternative ${id}`,
        timeoutMs: 120_000,
        read: () =>
          updatedJobs().findLast(
            (job) => job.id === id && ["ready", "failed"].includes(job.stage),
          ),
      }),
    ),
  );
  const trellis = jobs.find(
    (job) => job.kind === "generation-alternative" && job.method === "trellis2",
  );
  const sam = jobs.find(
    (job) => job.kind === "generation-alternative" && job.method === "sam3d",
  );
  assert.equal(trellis?.stage, "failed");
  assert.equal(trellis.error, "TRELLIS.2 stalled");
  assert.equal(sam?.stage, "ready", sam?.error);
  assert.ok(sam);
  const rawLog = readFileSync(
    join(folder, ".planner/generation", sam.id, "worker.log"),
    "utf8",
  );
  assert.match(rawLog, /RESULT \{/);
  assert.ok(
    daemon.frames.some(
      (frame) =>
        frame.type === "event" &&
        frame.event.kind === "job.log" &&
        frame.event.jobId === sam.id &&
        frame.event.lines.some((line) => line.startsWith("RESULT ")),
    ),
  );
  assert.ok(
    updatedJobs().every((job) => !job.lastLogLine?.includes("RESULT ")),
  );
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  assert.ok(!JSON.stringify(history).includes("RESULT "));
  for (const id of jobIds)
    assert.ok(
      updatedJobs().some(
        (job) =>
          job.id === id && job.waitingFor === "machine" && job.progress === 0,
      ),
    );
  const calls = z
    .array(
      z.object({
        worker: z.string(),
        targetFaces: z.number().optional(),
        pipelineType: z.string().optional(),
      }),
    )
    .parse(
      readFileSync(fixture.env.B17_CALLS, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
  assert.deepEqual(
    calls
      .filter((call) => call.worker === "generate_trellis")
      .map((call) => [call.pipelineType, call.targetFaces]),
    [
      ["512", 150_000],
      ["512", 50_000],
    ],
  );
  const retried = z.object({ jobIds: z.array(z.string()).length(1) }).parse(
    await daemon.command({
      type: "generation.alternatives",
      projectId: project.id,
      itemId: item.id,
      method: "trellis2",
    }),
  );
  const retriedId = retried.jobIds.at(0);
  const retryJob = await daemon.waitFor({
    label: "method retry",
    read: () => updatedJobs().find((job) => job.id === retriedId),
  });
  assert.ok(
    retryJob.kind === "generation-alternative" &&
      retryJob.method === "trellis2",
  );
  assert.equal(
    new Set(
      updatedJobs()
        .filter(
          (job) =>
            job.kind === "generation-alternative" && job.method === "sam3d",
        )
        .map((job) => job.id),
    ).size,
    1,
  );
  const repeated = z.object({ jobIds: z.array(z.string()) }).parse(
    await daemon.command({
      type: "generation.alternatives",
      projectId: project.id,
      itemId: item.id,
      method: "trellis2",
    }),
  );
  assert.deepEqual(repeated, retried);
  await daemon.waitFor({
    label: "persisted lower-face-count retry",
    timeoutMs: 120_000,
    read: () =>
      z
        .array(GenerationRecordSchema)
        .parse(
          JSON.parse(readFileSync(join(folder, ".planner/jobs.json"), "utf8")),
        )
        .find((record) => record.job.id === retriedId && record.attempt === 1),
  });
  await daemon.stop("SIGKILL");
  daemon = await fixture.start();
  const resumed = await daemon.waitFor({
    label: "resumed lower-face-count retry",
    timeoutMs: 120_000,
    read: () =>
      updatedJobs().findLast(
        (job) => job.id === retriedId && job.stage === "failed",
      ),
  });
  assert.equal(resumed.error, "TRELLIS.2 stalled");
  const restoredLog = JobLogResultSchema.parse(
    await daemon.command({ type: "job.log", jobId: sam.id }),
  );
  assert.ok(restoredLog.lines.some((line) => line.startsWith("RESULT ")));
  const migratedLog = JobLogResultSchema.parse(
    await daemon.command({ type: "job.log", jobId: "original" }),
  );
  assert.equal(
    migratedLog.lines.filter((line) => line.includes('RESULT {"old":true}'))
      .length,
    1,
  );
  assert.ok(
    daemon.frames.some(
      (frame) =>
        frame.type === "snapshot" &&
        frame.jobs.some(
          (job) =>
            job.id === "status" && job.lastLogLine === "Compared all views",
        ),
    ),
  );
  assert.equal(
    existsSync(join(folder, ".planner/generation/status/worker.log")),
    false,
  );
  const retryCalls = z
    .array(
      z.object({ outputDir: z.string(), targetFaces: z.number().optional() }),
    )
    .parse(
      readFileSync(fixture.env.B17_CALLS, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    )
    .filter(
      (call) =>
        call.outputDir ===
        join(folder, ".planner/generation", retriedId ?? "", "worker"),
    );
  assert.equal(
    retryCalls.filter((call) => call.targetFaces === 150_000).length,
    1,
  );
  assert.equal(retryCalls.at(-1)?.targetFaces, 50_000);
  const opened = ProjectSchema.parse(
    await daemon.command({ type: "project.open", projectId: project.id }),
  );
  assert.deepEqual(opened.scene.items, [item]);
  await daemon.stop();
  process.stdout.write(
    "gate:b17 passed: lock wait excluded, 90-second run limit, one 50k TRELLIS.2 retry preserved across restart, stall error, SAM 3D ready, method-only retry, active deduplication, raw output saved, streamed and restored after restart without entering chat; legacy output migrated once and status text retained\n",
  );
} finally {
  clearInterval(heartbeat);
  if (holderPid !== undefined) await stopProcessGroup(holderPid);
  await fixture.close();
}
