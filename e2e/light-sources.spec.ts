import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { generationFixture } from "../apps/web/e2e/generation-fixture.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

type Point = { x: number; y: number };

async function readFrame(page: Page) {
  const frame = await page
    .locator("canvas")
    .first()
    .screenshot({ mask: [page.getByTestId("job-status")] });
  return frame.toString("base64");
}

async function sampleLumas(options: {
  page: Page;
  frame: string;
  points: Point[];
}) {
  return options.page.evaluate(
    async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([
          Uint8Array.from(atob(input.frame), (code) => code.charCodeAt(0)),
        ]),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(bitmap, 0, 0);
      return input.points.map((point) => {
        const pixels = context.getImageData(
          Math.round(point.x) - 4,
          Math.round(point.y) - 4,
          9,
          9,
        ).data;
        const lumas = Array.from(
          { length: 81 },
          (_, index) =>
            0.3 * (pixels[index * 4] ?? 0) +
            0.59 * (pixels[index * 4 + 1] ?? 0) +
            0.11 * (pixels[index * 4 + 2] ?? 0),
        );
        return lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
      });
    },
    { frame: options.frame, points: options.points },
  );
}

async function sampleRgb(options: { page: Page; frame: string; point: Point }) {
  return options.page.evaluate(
    async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([
          Uint8Array.from(atob(input.frame), (code) => code.charCodeAt(0)),
        ]),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(
        Math.round(input.point.x) - 4,
        Math.round(input.point.y) - 4,
        9,
        9,
      ).data;
      return [0, 1, 2].map(
        (channel) =>
          Array.from(
            { length: 81 },
            (_, index) => pixels[index * 4 + channel] ?? 0,
          ).reduce((sum, value) => sum + value, 0) / 81,
      );
    },
    { frame: options.frame, point: options.point },
  );
}

async function compareFrames(options: {
  page: Page;
  before: string;
  after: string;
  points: { near: Point; far: Point };
}) {
  return options.page.evaluate(
    async (input) => {
      async function decode(png: string) {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(atob(png), (code) => code.charCodeAt(0))]),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Missing pixel context");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      }
      const before = await decode(input.before);
      const after = await decode(input.after);
      function luma(image: ImageData, point: Point) {
        const radius = 4;
        const values = Array.from(
          { length: (radius * 2 + 1) ** 2 },
          (_, index) => {
            const x = Math.round(point.x) - radius + (index % (radius * 2 + 1));
            const y =
              Math.round(point.y) -
              radius +
              Math.floor(index / (radius * 2 + 1));
            const at = (y * image.width + x) * 4;
            return (
              0.3 * (image.data[at] ?? 0) +
              0.59 * (image.data[at + 1] ?? 0) +
              0.11 * (image.data[at + 2] ?? 0)
            );
          },
        );
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      }
      const changedPixels = Array.from(
        { length: before.width * before.height },
        (_, index) =>
          [0, 1, 2].some(
            (channel) =>
              before.data[index * 4 + channel] !==
              after.data[index * 4 + channel],
          ),
      ).filter(Boolean).length;
      return {
        nearGain:
          luma(after, input.points.near) - luma(before, input.points.near),
        farGain: luma(after, input.points.far) - luma(before, input.points.far),
        changedShare: changedPixels / (before.width * before.height),
      };
    },
    {
      before: options.before,
      after: options.after,
      points: options.points,
    },
  );
}

test("a lamp switched on brightens what is near it and dims the room, and switched off restores the frame", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const project = await createProject({
    name: "Light sources",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  const folder = join(root, "projects", project.id, "assets", "lamp-block");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "model.glb"),
    generationFixture({ color: [0.9, 0.9, 0.85] }).glb,
  );
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "lamp-block",
      kind: "catalog",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "test", sourcePhotoIds: [] },
    }),
  );
  const lamp = {
    id: "lamp",
    name: "Floor lamp",
    model: { kind: "asset", assetId: "lamp-block" },
    placement: {
      kind: "floor",
      xM: -1,
      zM: -1,
      elevationM: 0,
      rotationRad: 0,
    },
    sizeM: { width: 0.25, height: 0.5, depth: 0.25 },
    locked: false,
  } satisfies Item;
  const camera = {
    positionM: { x: 2.5, y: 5, z: 4.5 },
    targetM: { x: 0, y: 0, z: 0 },
  };
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  for (const command of [
    { type: "item.add", item: lamp },
    { type: "surface.update", surfaceId: "floor", color: "#808080" },
    { type: "camera.set", camera },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  const points = {
    near: projectToScreen({
      camera,
      viewport,
      pointM: { x: -0.82, y: 0, z: -0.82 },
    }),
    far: projectToScreen({
      camera,
      viewport,
      pointM: { x: 1.2, y: 0, z: 1.2 },
    }),
  };
  const lampPoint = projectToScreen({
    camera,
    viewport,
    pointM: { x: -1, y: 0.25, z: -1 },
  });
  await page.mouse.move(20, 450);
  const unlit = await readFrame(page);

  await page.mouse.click(lampPoint.x, lampPoint.y);
  const source = page.getByRole("switch", { name: "Light source" });
  await expect(source).not.toBeChecked();
  await source.check();
  await expect(
    page.getByRole("switch", { name: "on", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("textbox", { name: "brightness" })).toHaveValue(
    "800",
  );
  await expect(page.getByTestId("bulb-state")).toContainText(/blender/i, {
    timeout: 30_000,
  });
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 450);
  await expect
    .poll(
      async () => {
        const result = await compareFrames({
          page,
          before: unlit,
          after: await readFrame(page),
          points,
        });
        return result.nearGain > 15 && result.farGain < -15;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("lamp-on.png") });
  const lit = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === "lamp");
  expect(lit?.light).toStrictEqual({
    on: true,
    emitter: { x: 0.5, y: 0.85, z: 0.5 },
    beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
    lumens: 800,
    temperatureK: 2700,
  });

  await page.mouse.click(lampPoint.x, lampPoint.y);
  const bulbY = page.getByRole("textbox", { name: "bulb y" });
  await expect(bulbY).toHaveValue("85");
  await bulbY.fill("60");
  await bulbY.press("Enter");
  await expect
    .poll(
      async () =>
        ProjectSchema.parse(
          await sendDaemonCommand({
            type: "project.open",
            projectId: project.id,
          }),
        ).scene.items.find((item) => item.id === "lamp")?.light?.emitter,
    )
    .toStrictEqual({ x: 0.5, y: 0.6, z: 0.5 });
  await page.getByLabel("beam", { exact: true }).selectOption("all");
  await expect
    .poll(
      async () =>
        ProjectSchema.parse(
          await sendDaemonCommand({
            type: "project.open",
            projectId: project.id,
          }),
        ).scene.items.find((item) => item.id === "lamp")?.light?.beam,
    )
    .toBeUndefined();
  await page.getByLabel("beam", { exact: true }).selectOption("down");
  async function readLamp() {
    return ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId: project.id }),
    ).scene.items.find((item) => item.id === "lamp");
  }
  await expect
    .poll(async () => (await readLamp())?.light?.beam)
    .toStrictEqual({ direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 });
  const jobChips = page
    .getByTestId("job-status")
    .getByRole("button", { name: /^Open find bulb/ });
  const jobCount = await jobChips.count();
  await page.getByRole("button", { name: "Find bulb again" }).click();
  await expect(jobChips).toHaveCount(jobCount + 1);
  await expect(page.getByTestId("bulb-state")).toContainText(/blender/i, {
    timeout: 30_000,
  });
  await page.getByLabel("shade", { exact: true }).selectOption("translucent");
  await expect
    .poll(async () => (await readLamp())?.light?.shade)
    .toBe("translucent");
  await page.getByRole("switch", { name: "Light source" }).uncheck();
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 450);
  await expect
    .poll(
      async () =>
        (
          await compareFrames({
            page,
            before: unlit,
            after: await readFrame(page),
            points,
          })
        ).changedShare,
      { timeout: 15_000 },
    )
    .toBe(0);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await readLamp())?.light?.on).toBe(true);

  await page.mouse.click(lampPoint.x, lampPoint.y, { button: "right" });
  const menu = page.getByTestId("object-context-menu");
  await menu.getByRole("menuitem", { name: "Turn light off" }).click();
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 450);
  await expect
    .poll(
      async () =>
        (
          await compareFrames({
            page,
            before: unlit,
            after: await readFrame(page),
            points,
          })
        ).changedShare,
      { timeout: 15_000 },
    )
    .toBe(0);
  await page.screenshot({ path: testInfo.outputPath("lamp-off.png") });

  await page.locator("canvas").first().focus();
  await page.keyboard.press("o");
  await expect(
    page
      .getByRole("region", { name: "Project objects" })
      .getByTestId("light-state"),
  ).toHaveText("light off");
});

test("a downward beam lights the floor under the lamp but not the wall above its shade, and a translucent shade glows", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const project = await createProject({
    name: "Beam",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  const folder = join(root, "projects", project.id, "assets", "lamp-block");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "model.glb"),
    generationFixture({ color: [0.9, 0.35, 0.05] }).glb,
  );
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "lamp-block",
      kind: "catalog",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "test", sourcePhotoIds: [] },
    }),
  );
  const light = {
    on: true,
    emitter: { x: 0.5, y: 0.9, z: 0.5 },
    lumens: 800,
    temperatureK: 2700,
  };
  const lamp = {
    id: "lamp",
    name: "Floor lamp",
    model: { kind: "asset", assetId: "lamp-block" },
    placement: {
      kind: "floor",
      xM: -1.75,
      zM: 0,
      elevationM: 0,
      rotationRad: 0,
    },
    sizeM: { width: 0.2, height: 1.4, depth: 0.2 },
    light: {
      ...light,
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
    },
    locked: false,
  } satisfies Item;
  const camera = {
    positionM: { x: 2, y: 1.4, z: 0.4 },
    targetM: { x: -2, y: 0.9, z: 0 },
  };
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  for (const command of [
    { type: "item.add", item: lamp },
    { type: "surface.update", surfaceId: "floor", color: "#808080" },
    { type: "camera.set", camera },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  const point = (pointM: { x: number; y: number; z: number }) =>
    projectToScreen({ camera, viewport, pointM });
  const floorUnder = point({ x: -1.75, y: 0, z: 0.45 });
  const floorAway = point({ x: 0.2, y: 0, z: 1.2 });
  const wallBelow = point({ x: -2, y: 0.6, z: 0.3 });
  const wallAbove = point({ x: -2, y: 1.85, z: 0.3 });
  await page.mouse.move(20, 450);
  await expect
    .poll(
      async () => {
        const [under = 0, away = 0, below = 0, above = 0] = await sampleLumas({
          page,
          frame: await readFrame(page),
          points: [floorUnder, floorAway, wallBelow, wallAbove],
        });
        return under - away > 15 && below - above > 30;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const beamFrame = await readFrame(page);
  await page.screenshot({ path: testInfo.outputPath("beam-down.png") });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.update", itemId: "lamp", patch: { light } },
  });
  await expect
    .poll(
      async () =>
        (
          await compareFrames({
            page,
            before: beamFrame,
            after: await readFrame(page),
            points: { near: wallBelow, far: wallAbove },
          })
        ).farGain,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(15);
  await page.screenshot({ path: testInfo.outputPath("all-directions.png") });
  const shadeSide = point({ x: -1.65, y: 1.3, z: 0 });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: "lamp",
      patch: { light: { ...lamp.light, shade: "translucent" } },
    },
  });
  await expect
    .poll(
      async () =>
        (
          await compareFrames({
            page,
            before: beamFrame,
            after: await readFrame(page),
            points: { near: shadeSide, far: wallAbove },
          })
        ).nearGain,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(30);
  const wallNear = point({ x: -2, y: 1.45, z: 0.3 });
  const [opaqueRed = 0, , opaqueBlue = 1] = await sampleRgb({
    page,
    frame: beamFrame,
    point: wallNear,
  });
  const [translucentRed = 0, , translucentBlue = 1] = await sampleRgb({
    page,
    frame: await readFrame(page),
    point: wallNear,
  });
  expect(translucentRed / translucentBlue).toBeGreaterThan(
    (opaqueRed / opaqueBlue) * 1.1,
  );
  await page.screenshot({ path: testInfo.outputPath("translucent.png") });
});

test("Turn lights on switches every selected lamp in one undo step", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const project = await createProject({
    name: "Bulk lights",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  const folder = join(root, "projects", project.id, "assets", "lamp-block");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "model.glb"), generationFixture().glb);
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "lamp-block",
      kind: "catalog",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "test", sourcePhotoIds: [] },
    }),
  );
  const camera = {
    positionM: { x: 0, y: 5, z: 4 },
    targetM: { x: 0, y: 0, z: 0 },
  };
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  const lamps = [-0.8, 0.8].map(
    (xM, index) =>
      ({
        id: `lamp-${index + 1}`,
        name: `Lamp ${index + 1}`,
        model: { kind: "asset", assetId: "lamp-block" },
        placement: { kind: "floor", xM, zM: 0, elevationM: 0, rotationRad: 0 },
        sizeM: { width: 0.3, height: 0.5, depth: 0.3 },
        light: {
          on: false,
          emitter: { x: 0.5, y: 0.85, z: 0.5 },
          lumens: 400,
          temperatureK: 2700,
        },
        locked: false,
      }) satisfies Item,
  );
  for (const command of [
    ...lamps.map((item) => ({ type: "item.add", item })),
    { type: "camera.set", camera },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  async function lightsOn() {
    return ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId: project.id }),
    ).scene.items.map((item) => item.light?.on);
  }
  const points = lamps.map((item) =>
    projectToScreen({
      camera,
      viewport,
      pointM: {
        x: item.placement.xM,
        y: 0.25,
        z: 0,
      },
    }),
  );
  const [first, second] = points;
  if (!first || !second) throw new Error("Missing lamp points");
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await page.mouse.click(second.x, second.y, { button: "right" });
  await page
    .getByTestId("object-context-menu")
    .getByRole("menuitem", { name: "Turn lights on" })
    .click();
  await expect.poll(lightsOn).toStrictEqual([true, true]);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(lightsOn).toStrictEqual([false, false]);
});
