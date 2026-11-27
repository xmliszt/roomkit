import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { writeJson } from "../util/write-json.ts";
import { GenerationRecordSchema } from "./generation-record-schema.ts";
import { prepareGenerationFolder } from "./prepare-generation-folder.ts";
import { runAlternativeWorker } from "./run-alternative-worker.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(options: {
  mode: string;
  method?: "trellis2" | "sam3d";
  inactivityMs?: number;
}) {
  const root = mkdtempSync(join(tmpdir(), "planner-b17-"));
  roots.push(root);
  const folder = join(root, "job");
  mkdirSync(folder);
  writeFileSync(join(folder, "photo.png"), "photo");
  writeFileSync(
    join(folder, "job.json"),
    JSON.stringify({ name: "Sofa", photos: ["photo.png"], masks: [] }),
  );
  const now = new Date().toISOString();
  const record = GenerationRecordSchema.parse({
    job: {
      id: "job",
      kind: "generation-alternative",
      projectId: crypto.randomUUID(),
      itemId: "item",
      method: options.method ?? "trellis2",
      stage: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    },
    item: {
      id: "item",
      name: "Sofa",
      model: { kind: "pending", jobId: "original" },
      placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
      sizeM: { width: 2, height: 1, depth: 1 },
      locked: false,
    },
    source: { kind: "photo", photoId: "photo" },
    prompt: "Sofa",
    held: false,
    attempt: 0,
    assetId: "asset",
  });
  return {
    record,
    folder,
    repo: resolve("."),
    weightsRoot: root,
    python: resolve("packages/daemon/test/fixtures/timeout-python.mjs"),
    env: {
      PATH: process.env.PATH,
      PLANNER_HOME: root,
      PLANNER_PROJECTS: root,
      PLANNER_MACHINE_LOCK: join(root, "machine.lock"),
      PLANNER_PYTHON_TIMEOUT_MS: "30000",
      PLANNER_PYTHON_INACTIVITY_MS: String(options.inactivityMs ?? 500),
      B17_CALLS: join(root, "calls.jsonl"),
      B17_MODE: options.mode,
    },
    signal: new AbortController().signal,
    processPath: join(root, "process.json"),
    onProgress: vi.fn(),
    onLine: vi.fn(),
    onRetry: vi.fn(),
  } satisfies Parameters<typeof runAlternativeWorker>[0];
}
function calls(options: ReturnType<typeof fixture>) {
  return z
    .array(
      z.object({
        worker: z.string(),
        pipelineType: z.string().optional(),
        targetFaces: z.number().optional(),
      }),
    )
    .parse(
      readFileSync(options.env.B17_CALLS, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
}

test("a stalled TRELLIS.2 retries once at 50k faces then reports the stall", async () => {
  const options = fixture({ mode: "stall" });
  await expect(runAlternativeWorker(options)).rejects.toThrow(
    "TRELLIS.2 stalled",
  );
  expect(
    calls(options).map((call) => [call.pipelineType, call.targetFaces]),
  ).toEqual([
    ["512", 150_000],
    ["512", 50_000],
  ]);
  expect(existsSync(options.processPath)).toBe(false);
  expect(existsSync(options.env.PLANNER_MACHINE_LOCK)).toBe(false);
  expect(options.record.attempt).toBe(1);
  expect(options.onRetry).toHaveBeenCalledTimes(1);
  expect(options.onLine).toHaveBeenCalledWith(
    "TRELLIS.2 stalled; retrying at 50,000 faces",
  );
});

test("the lower-face-count retry can publish its result", async () => {
  const options = fixture({ mode: "stall-once", inactivityMs: 2_000 });
  await expect(runAlternativeWorker(options)).resolves.toMatchObject({
    model: "trellis2",
  });
  expect(calls(options)).toHaveLength(2);
  expect(readFileSync(join(options.folder, "raw.glb"), "utf8")).toBe(
    "fake glb",
  );
});

test.each(["error", "raw-error"])(
  "worker errors stay in the log without triggering the stall retry (%s)",
  async (mode) => {
    const options = fixture({ mode });
    await expect(runAlternativeWorker(options)).rejects.toThrow(
      "Alternative TRELLIS.2 failed; see the job log",
    );
    expect(calls(options)).toHaveLength(1);
    expect(options.onLine).toHaveBeenCalledWith(
      expect.stringContaining(
        mode === "error" ? "invalid reference" : "private worker diagnostic",
      ),
    );
  },
);

test("a stalled SAM 3D fails without a TRELLIS.2 retry", async () => {
  const options = fixture({ mode: "normal", method: "sam3d" });
  await expect(
    runAlternativeWorker({
      ...options,
      env: { ...options.env, B17_RUN_MS: "60000" },
    }),
  ).rejects.toThrow("SAM 3D stalled: no progress for 1 s");
  expect(calls(options)).toHaveLength(1);
});

test("steady progress keeps a worker alive past the inactivity limit until the hard cap", async () => {
  const options = fixture({ mode: "progress", method: "sam3d" });
  const startedMs = Date.now();
  await expect(
    runAlternativeWorker({
      ...options,
      env: {
        ...options.env,
        PLANNER_PYTHON_TIMEOUT_MS: "2000",
        B17_RUN_MS: "60000",
      },
    }),
  ).rejects.toThrow("SAM 3D took longer than 2 s");
  expect(Date.now() - startedMs).toBeGreaterThanOrEqual(2000);
  expect(calls(options)).toHaveLength(1);
});

test("heartbeats neither count as progress nor reach the job", async () => {
  const options = fixture({ mode: "heartbeat", method: "sam3d" });
  await expect(
    runAlternativeWorker({
      ...options,
      env: { ...options.env, B17_RUN_MS: "60000" },
    }),
  ).rejects.toThrow("SAM 3D stalled");
  expect(options.onProgress).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: "running" }),
  );
});

test("a user-facing worker message reaches the job and other worker errors do not", async () => {
  await expect(
    runAlternativeWorker(fixture({ mode: "user-error", method: "sam3d" })),
  ).rejects.toThrow(/^Could not find the Sofa in the reference photo$/);
  await expect(
    runAlternativeWorker(fixture({ mode: "error", method: "sam3d" })),
  ).rejects.toThrow(/^Alternative SAM 3D failed; see the job log$/);
});

test("an unmasked photo of an item without a name fails with a readable message", async () => {
  const options = fixture({ mode: "normal" });
  writeFileSync(
    join(options.folder, "job.json"),
    JSON.stringify({ name: " ", photos: ["photo.png"], masks: [] }),
  );
  await expect(runAlternativeWorker(options)).rejects.toThrow(
    /^Name the item so it can be found in the reference photo$/,
  );
  expect(existsSync(options.env.B17_CALLS)).toBe(false);
});

test("the worker receives the item name to find the object in an unmasked photo", async () => {
  const options = fixture({ mode: "normal", method: "sam3d" });
  await runAlternativeWorker(options);
  expect(
    z
      .object({ name: z.string(), maskPath: z.string().optional() })
      .parse(JSON.parse(readFileSync(options.env.B17_CALLS, "utf8").trim())),
  ).toEqual({ name: "Sofa" });
});

test("aborting TRELLIS.2 does not retry", async () => {
  const options = fixture({ mode: "stall" });
  const controller = new AbortController();
  await expect(
    runAlternativeWorker({
      ...options,
      signal: controller.signal,
      onProgress(progress) {
        if (progress.stage === "export") controller.abort();
      },
    }),
  ).rejects.toThrow();
  expect(calls(options)).toHaveLength(1);
  expect(existsSync(options.env.PLANNER_MACHINE_LOCK)).toBe(false);
});

test("a resumed TRELLIS.2 retry starts at 50k and has no further retry", async () => {
  const options = fixture({ mode: "stall" });
  options.record.attempt = 1;
  await expect(runAlternativeWorker(options)).rejects.toThrow(
    "TRELLIS.2 stalled",
  );
  expect(calls(options).map((call) => call.targetFaces)).toEqual([50_000]);
  expect(options.onRetry).not.toHaveBeenCalled();
});

test("an alternative for a multi-photo object runs on the primary photo", async () => {
  const options = fixture({ mode: "normal" });
  const projectFolder = join(options.weightsRoot, "project");
  const photoIds = ["front", "side", "back"];
  mkdirSync(join(projectFolder, "photos", "upright"), { recursive: true });
  for (const photoId of photoIds)
    copyFileSync(
      resolve("packages/daemon/catalog/charging-port/thumb.png"),
      join(projectFolder, "photos", "upright", `${photoId}.jpg`),
    );
  writeJson({
    path: join(projectFolder, "photos", "photos.json"),
    value: {
      version: 1,
      photos: photoIds.map((photoId) => ({
        photoId,
        origin: "chat",
        sourceFileName: `${photoId}.png`,
        widthPx: 512,
        heightPx: 512,
        orientation: 1,
        blurScore: 1,
        kind: "accepted",
        uprightPath: `upright/${photoId}.jpg`,
        visionPath: `vision/${photoId}.jpg`,
        visionWidthPx: 512,
        visionHeightPx: 512,
      })),
    },
  });
  options.record.source = {
    kind: "photo",
    photoId: "side",
    extraPhotoIds: ["front", "back"],
  };
  rmSync(options.folder, { recursive: true });
  await prepareGenerationFolder({
    record: options.record,
    projectFolder,
    folder: options.folder,
    blenderDir: resolve("blender"),
    allowedHosts: [],
  });
  await expect(runAlternativeWorker(options)).resolves.toMatchObject({
    model: "trellis2",
  });
  expect(
    z
      .array(z.object({ photoPath: z.string() }))
      .parse(
        readFileSync(options.env.B17_CALLS, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      )
      .map((call) => call.photoPath),
  ).toEqual([realpathSync(join(options.folder, "photos", "side.jpg"))]);
});
