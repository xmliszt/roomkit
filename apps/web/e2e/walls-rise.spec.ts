import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { expect, test } from "@playwright/test";
import { mockGeneration } from "./mock-generation.ts";

test("reconstruction shows real points, floor hairlines, rising walls and a reduced-motion crossfade", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 0 });
  fixture.apply({
    command: {
      type: "camera.set",
      camera: {
        positionM: { x: 10, y: 9, z: 12 },
        targetM: { x: 0, y: 1, z: 0 },
      },
    },
  });
  const points = Buffer.alloc(8000 * 24);
  for (let index = 0; index < 8000; index++) {
    const wall = index % 4;
    const along = ((index * 37) % 997) / 997;
    const y = (((index * 71) % 991) / 991) * 2.8;
    const xyz =
      wall < 2
        ? [wall ? 2.1 : -2.1, y, along * 5.4 - 2.7]
        : [along * 4.2 - 2.1, y, wall === 2 ? -2.7 : 2.7];
    [...xyz, 0.75, 0.28, 0.1].forEach((value, axis) => {
      points.writeFloatLE(value, index * 24 + axis * 4);
    });
  }
  await page.route("**/reconstruction/*/points.bin", (route) =>
    route.fulfill({
      contentType: "application/octet-stream",
      headers: { "access-control-allow-origin": "*" },
      body: points,
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("planner:floor-grid", "false");
    localStorage.setItem("planner:object-labels", "false");
  });
  await page.clock.install();
  await page.goto(`/projects/${fixture.projectId}`);
  const scene = page.getByTestId("scene");
  await expect(scene).toHaveAttribute("data-room-stage", "complete");
  const job: ReconstructionJob = {
    id: "recon-rise",
    projectId: fixture.projectId,
    kind: "reconstruction",
    stage: "geometry",
    progress: 0.3,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
  };
  fixture.updateJob(job);
  await expect(scene).toHaveAttribute("data-room-stage", "waiting");
  await expect(scene).toHaveAttribute("data-room-opacity", "0");
  fixture.updateJob({
    ...job,
    stage: "coverage",
    pointCloudReady: true,
    progress: 0.8,
  });
  await expect(scene).toHaveAttribute("data-room-stage", "points");
  const evidence = resolve("docs/work-packages/evidence");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "a28-points.png") });
  await page.clock.pauseAt(new Date(Date.now() + 100));
  const walls = [
    { id: "west", kind: "solid", startM: { x: -2.1, z: 2.7 } },
    { id: "north", kind: "solid", startM: { x: 2.1, z: 2.7 } },
    { id: "east", kind: "solid", startM: { x: 2.1, z: -2.7 } },
    { id: "south", kind: "solid", startM: { x: -2.1, z: -2.7 } },
  ] satisfies Room["walls"];
  fixture.apply({
    command: {
      type: "room.update",
      walls,
      ceilingHeightM: 2.8,
      placements: {},
    },
  });
  await page.clock.runFor(350);
  await expect(scene).toHaveAttribute("data-room-stage", "floor");
  await page.screenshot({ path: resolve(evidence, "a28-floor.png") });
  await page.clock.runFor(650);
  await expect(scene).toHaveAttribute("data-room-stage", "walls");
  expect(Number(await scene.getAttribute("data-room-height"))).toBeGreaterThan(
    0,
  );
  expect(Number(await scene.getAttribute("data-room-height"))).toBeLessThan(1);
  await page.screenshot({ path: resolve(evidence, "a28-walls.png") });
  await page.clock.runFor(850);
  await expect(scene).toHaveAttribute("data-room-stage", "fading");
  await page.clock.runFor(700);
  await expect(scene).toHaveAttribute("data-room-stage", "complete");
  fixture.updateJob({
    ...job,
    stage: "done",
    pointCloudReady: true,
    progress: 1,
  });
  await page.clock.resume();
  await page.reload();
  await expect(scene).toHaveAttribute("data-room-stage", "complete");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedJob = {
    ...job,
    id: "recon-reduced",
    createdAt: "2026-11-25T01:00:00Z",
  };
  fixture.updateJob(reducedJob);
  await expect(scene).toHaveAttribute("data-room-stage", "waiting");
  fixture.updateJob({
    ...reducedJob,
    stage: "coverage",
    pointCloudReady: true,
  });
  await expect(scene).toHaveAttribute("data-room-stage", "points");
  fixture.apply({
    command: {
      type: "room.update",
      walls,
      ceilingHeightM: 2.9,
      placements: {},
    },
  });
  fixture.updateJob({
    ...reducedJob,
    stage: "done",
    progress: 1,
    pointCloudReady: true,
  });
  await expect(scene).toHaveAttribute("data-room-stage", "fading");
  await expect(scene).toHaveAttribute("data-room-height", "1");
  await expect(scene).toHaveAttribute("data-room-stage", "complete");
});
