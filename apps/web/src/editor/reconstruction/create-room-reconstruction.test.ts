import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import { expect, test } from "vitest";
import { createRoomReconstruction } from "./create-room-reconstruction.ts";

const job: ReconstructionJob = {
  id: "recon",
  kind: "reconstruction",
  projectId: "00000000-0000-4000-8000-000000000001",
  stage: "geometry",
  progress: 0.3,
  createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z",
};

test("reconstruction waits for real points then traces, rises and fades in order", () => {
  const animation = createRoomReconstruction();
  const input = {
    job,
    roomKey: "default",
    nowMs: 0,
    cloud: "missing",
    reduced: false,
  } satisfies Parameters<typeof animation.tick>[0];
  expect(animation.tick(input)).toMatchObject({ stage: "waiting", opacity: 0 });
  const preview = {
    ...input,
    job: { ...job, pointCloudReady: true },
    cloud: "ready",
    nowMs: 100,
  } satisfies Parameters<typeof animation.tick>[0];
  expect(animation.tick(preview).stage).toBe("points");
  const measured = { ...preview, roomKey: "measured", nowMs: 150 };
  expect(animation.tick(measured).stage).toBe("points");
  expect(animation.tick({ ...measured, nowMs: 650 })).toMatchObject({
    stage: "floor",
    height: 0,
    opacity: 0,
  });
  const walls = animation.tick({ ...measured, nowMs: 1400 });
  expect(walls.stage).toBe("walls");
  expect(walls.height).toBeGreaterThan(0);
  expect(walls.height).toBeLessThan(1);
  expect(animation.tick({ ...measured, nowMs: 2400 }).stage).toBe("fading");
  expect(animation.tick({ ...measured, nowMs: 2800 })).toMatchObject({
    stage: "complete",
    height: 1,
    pointsOpacity: 0,
  });
});

test("same-sized measurements, reduced motion, cancellation and completed snapshots", () => {
  const animation = createRoomReconstruction();
  const input = {
    job,
    roomKey: "same",
    nowMs: 0,
    cloud: "missing",
    reduced: true,
  } satisfies Parameters<typeof animation.tick>[0];
  animation.tick(input);
  const measured = {
    ...input,
    job: { ...job, stage: "done" },
    nowMs: 1,
  } satisfies Parameters<typeof animation.tick>[0];
  expect(animation.tick(measured)).toMatchObject({
    stage: "fading",
    height: 1,
    opacity: 0,
  });
  expect(animation.tick({ ...measured, nowMs: 101 })).toMatchObject({
    opacity: 0.5,
    height: 1,
    pointsOpacity: 0.5,
  });
  expect(animation.tick({ ...measured, nowMs: 201 }).stage).toBe("complete");
  expect(createRoomReconstruction().tick(measured).stage).toBe("complete");
  expect(
    animation.tick({ ...input, job: { ...job, stage: "cancelled" } }),
  ).toMatchObject({ stage: "complete", pointsOpacity: 0 });
});

test("a missing preview after a slow download still animates the measured room", () => {
  const animation = createRoomReconstruction();
  const input = {
    job: { ...job, pointCloudReady: true },
    roomKey: "default",
    nowMs: 0,
    cloud: "pending",
    reduced: false,
  } satisfies Parameters<typeof animation.tick>[0];
  animation.tick(input);
  const measured = { ...input, roomKey: "measured", nowMs: 100 };
  expect(animation.tick(measured).stage).toBe("waiting");
  expect(
    animation.tick({ ...measured, cloud: "missing", nowMs: 10000 }),
  ).toMatchObject({ stage: "floor", height: 0 });
  expect(
    animation.tick({ ...measured, cloud: "missing", nowMs: 11000 }).stage,
  ).toBe("walls");
});
