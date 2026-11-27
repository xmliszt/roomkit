import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { cameraFramingFixture } from "./camera-framing-fixture.ts";

async function shownCamera(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-camera");
  return value === null ? undefined : CameraSchema.parse(JSON.parse(value));
}

async function expectFramed(options: { page: Page; room: Room }) {
  await expect
    .poll(async () => {
      const saved = await shownCamera(options.page);
      const box = await options.page.getByTestId("scene").boundingBox();
      if (!saved || !box) return false;
      const camera = new PerspectiveCamera(
        32,
        box.width / box.height,
        0.1,
        200,
      );
      camera.position.copy(saved.positionM);
      camera.lookAt(new Vector3().copy(saved.targetM));
      camera.updateMatrixWorld();
      return options.room.walls.every((wall) => {
        const corner = new Vector3(wall.startM.x, 0, wall.startM.z).project(
          camera,
        );
        return (
          Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1 &&
          Math.abs(corner.z) < 1
        );
      });
    })
    .toBe(true);
}

test("room replacement frames every corner, saves the view, and shares F framing", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await cameraFramingFixture({ page });
  await page.goto(`/projects/${fixture.project.id}`);
  await expect
    .poll(() => shownCamera(page))
    .toEqual(fixture.project.scene.camera);
  await page.screenshot({ path: testInfo.outputPath("close-up.png") });
  const room = createRectangularScene({
    widthM: 3.4,
    depthM: 5.6,
    ceilingHeightM: 2.9,
  }).room;
  const walls = room.walls.map((wall) => ({
    ...wall,
    startM: { x: wall.startM.x + 5, z: wall.startM.z - 3 },
  }));
  fixture.apply({
    command: {
      type: "room.update",
      walls,
      ceilingHeightM: room.ceilingHeightM,
    },
  });
  await expectFramed({ page, room: fixture.project.scene.room });
  await expect
    .poll(
      () =>
        fixture.commands.filter((command) => command.type === "camera.set")
          .length,
    )
    .toBe(1);
  const framed = await shownCamera(page);
  expect(fixture.project.scene.camera).toEqual(framed);
  await page.screenshot({ path: testInfo.outputPath("room-framed.png") });
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(520, 400, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => shownCamera(page)).not.toEqual(framed);
  await page.keyboard.press("f");
  await expect.poll(() => shownCamera(page)).toEqual(framed);
  await page.reload();
  await expect.poll(() => shownCamera(page)).toEqual(framed);
});

test("small room edits keep the view; a reconstruction with the same footprint frames it", async ({
  page,
}) => {
  const fixture = await cameraFramingFixture({ page });
  await page.goto(`/projects/${fixture.project.id}`);
  const before = structuredClone(fixture.project.scene.camera);
  await expect.poll(() => shownCamera(page)).toEqual(before);
  await page.getByTestId("room-size").click();
  await page.getByLabel("width", { exact: true }).fill("4.10");
  await page.getByLabel("width", { exact: true }).press("Enter");
  await expect(page.getByTestId("room-size")).toContainText("4.10");
  expect(await shownCamera(page)).toEqual(before);
  expect(
    fixture.commands.filter((command) => command.type === "camera.set"),
  ).toHaveLength(0);
  fixture.reconstruct({ stage: "done" });
  await expectFramed({ page, room: fixture.project.scene.room });
  await expect.poll(() => fixture.project.scene.camera).not.toEqual(before);
  expect(fixture.project.scene.camera).toEqual(await shownCamera(page));
});

test("a reconstruction committed before a later job failure still frames the room", async ({
  page,
}) => {
  const fixture = await cameraFramingFixture({ page });
  await page.goto(`/projects/${fixture.project.id}`);
  const before = structuredClone(fixture.project.scene.camera);
  await expect.poll(() => shownCamera(page)).toEqual(before);
  fixture.reconstruct({ stage: "failed" });
  await expectFramed({ page, room: fixture.project.scene.room });
  await expect.poll(() => fixture.project.scene.camera).not.toEqual(before);
  expect(fixture.project.scene.camera).toEqual(await shownCamera(page));
});

for (const isInvalid of [true, false]) {
  test(`reload ${isInvalid ? "repairs an outside target" : "preserves an inside view"}`, async ({
    page,
  }, testInfo) => {
    const fixture = await cameraFramingFixture({ page });
    await page.goto(`/projects/${fixture.project.id}`);
    await expect.poll(() => shownCamera(page)).toBeDefined();
    fixture.project.scene.camera = isInvalid
      ? { positionM: { x: 12, y: 4, z: 12 }, targetM: { x: 10, y: 1, z: 10 } }
      : { positionM: { x: 0, y: 1, z: 0 }, targetM: { x: 1, y: 1, z: 1 } };
    const saved = structuredClone(fixture.project.scene.camera);
    await page.reload();
    if (isInvalid) {
      await expectFramed({ page, room: fixture.project.scene.room });
    } else {
      await expect.poll(() => shownCamera(page)).toEqual(saved);
    }
    await expect
      .poll(
        () =>
          fixture.commands.filter((command) => command.type === "camera.set")
            .length,
      )
      .toBe(isInvalid ? 1 : 0);
    expect(fixture.project.scene.camera).toEqual(await shownCamera(page));
    await page.screenshot({
      path: testInfo.outputPath("saved-camera-repaired.png"),
    });
  });
}

test("reload repairs below-floor cameras and orbit stays above the floor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await cameraFramingFixture({ page });
  fixture.project.scene.camera = {
    positionM: { x: 0, y: -1, z: 0 },
    targetM: { x: 0, y: 1, z: 0 },
  };
  await page.goto(`/projects/${fixture.project.id}`);
  await expectFramed({ page, room: fixture.project.scene.room });
  function cameraCommands() {
    return fixture.commands.filter((command) => command.type === "camera.set");
  }
  await expect.poll(() => cameraCommands().length).toBe(1);
  for (const y of [-700, 1700]) {
    const commandCount = cameraCommands().length;
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(700, y, { steps: 16 });
    await page.mouse.up();
    await expect
      .poll(() => cameraCommands().length)
      .toBeGreaterThan(commandCount);
    const camera = cameraCommands().at(-1)?.camera;
    if (!camera) throw new Error("No orbit camera report");
    const offset = new Vector3()
      .copy(camera.positionM)
      .sub(new Vector3().copy(camera.targetM));
    expect(camera.positionM.y).toBeGreaterThanOrEqual(0);
    expect(Math.acos(offset.y / offset.length())).toBeLessThanOrEqual(1.4501);
  }
});
