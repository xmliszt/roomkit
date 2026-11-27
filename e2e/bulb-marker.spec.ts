import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { generationFixture } from "../apps/web/e2e/generation-fixture.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 3, y: 3, z: 5 },
  targetM: { x: 0, y: 0.7, z: 0 },
};

function isolatedRoot() {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  return root;
}

function readLightingFrame(options: { page: Page }) {
  return options.page.locator("canvas").first().screenshot({
    style:
      '[data-testid="chrome"], [data-testid="item-tag"], [data-testid="item-dimension"], [data-testid="wall-dimension"], [data-testid="bulb-marker"], svg { opacity: 0 !important; }',
  });
}

async function snapshot(options: { page: Page; path: string }) {
  const download = options.page.waitForEvent("download");
  await options.page.keyboard.press("Meta+Shift+S");
  await (await download).saveAs(options.path);
  return readFileSync(options.path);
}

test("bulb projects through its model, highlights, drags in one undo step and stays out of snapshots", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const project = await createProject({
    name: "Bulb marker",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const asset = join(
    isolatedRoot(),
    "projects",
    project.id,
    "assets",
    "lamp-block",
  );
  mkdirSync(asset, { recursive: true });
  writeFileSync(
    join(asset, "model.glb"),
    generationFixture({ color: [0.8, 0.8, 0.8] }).glb,
  );
  writeFileSync(
    join(asset, "meta.json"),
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
    id: "toString",
    name: "Marker lamp",
    model: { kind: "asset", assetId: "lamp-block" },
    placement: {
      kind: "floor",
      xM: 0,
      zM: 0,
      elevationM: 0,
      rotationRad: Math.PI / 2,
    },
    sizeM: { width: 1, height: 2, depth: 0.5 },
    mirrored: true,
    locked: false,
    light: {
      on: false,
      lumens: 400,
      temperatureK: 2700,
      emitter: { x: 0.25, y: 0.5, z: 0.7 },
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
    },
  } satisfies Item;
  for (const command of [
    { type: "item.add", item: lamp },
    { type: "camera.set", camera },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  const updates: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const value = JSON.parse(String(payload));
      if (value.type === "scene.apply" && value.command?.type === "item.update")
        updates.push(value.command);
    }),
  );
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  const tag = page.getByTestId("item-tag").filter({ hasText: "marker lamp" });
  await expect(tag).toHaveAttribute("data-load-in-stage", "done", {
    timeout: 15_000,
  });
  await page.mouse.click(
    ...(() => {
      const point = projectToScreen({
        camera,
        viewport,
        pointM: { x: 0, y: 1, z: 0 },
      });
      return [point.x, point.y] satisfies [number, number];
    })(),
  );
  const marker = page.getByTestId("bulb-marker");
  await expect(marker).toBeVisible();
  const expected = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0.1, y: 1, z: -0.25 },
  });
  const bounds = await marker.boundingBox();
  if (!bounds) throw new Error("Missing bulb marker bounds");
  expect(bounds.x + bounds.width / 2).toBeCloseTo(expected.x, 0);
  expect(bounds.y + bounds.height / 2).toBeCloseTo(expected.y, 0);
  await page.getByRole("textbox", { name: "bulb y", exact: true }).focus();
  await expect(marker).toHaveAttribute("data-highlighted", "true");
  const bulbY = page.getByRole("textbox", { name: "bulb y", exact: true });
  await bulbY.fill("90");
  await bulbY.press("Escape");
  await expect(bulbY).toHaveValue("50");
  await expect(marker).toBeVisible();
  await page.locator("canvas").focus();
  await page.getByRole("textbox", { name: "bulb x", exact: true }).hover();
  await expect(marker).toHaveAttribute("data-highlighted", "true");
  await expect(page.getByTestId("bulb-axis")).toHaveAttribute(
    "data-field",
    "x",
  );
  await page.mouse.move(10, 450);
  await expect(marker).toHaveAttribute("data-highlighted", "false");
  const orbitCamera = await page
    .getByTestId("scene")
    .getAttribute("data-camera");
  const start = { x: bounds.x + 12, y: bounds.y + 12 };
  await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y - 80, { steps: 10 });
  await expect
    .poll(async () => (await marker.boundingBox())?.y ?? bounds.y)
    .toBeLessThan(bounds.y);
  expect(updates).toHaveLength(0);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(() => updates.length).toBe(1);
  const moved = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === lamp.id);
  expect(moved?.light?.emitter.y).toBeGreaterThan(0.5);
  expect(moved?.light?.emitter.x).toBe(0.25);
  expect(moved?.light?.emitter.z).toBe(0.7);
  expect(moved?.placement).toEqual(lamp.placement);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    orbitCamera ?? "",
  );
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    JSON.stringify([lamp.id]),
  );
  await expect(marker).toHaveAttribute("data-highlighted", "false");
  await expect(page.getByTestId("bulb-axis")).toHaveAttribute("d", "");
  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+z");
  await expect(
    page.getByRole("textbox", { name: "bulb y", exact: true }),
  ).toHaveValue("50");
  const restored = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  );
  expect(
    restored.scene.items.find((item) => item.id === lamp.id)?.light?.emitter,
  ).toEqual(lamp.light.emitter);
  await page.mouse.move(10, 450);
  const plain = {
    ...lamp,
    id: "plain",
    model: { kind: "pending", jobId: "plain-pending" },
    name: "Plain item",
    light: undefined,
    sizeM: { width: 0.3, height: 1, depth: 0.3 },
    placement: { ...lamp.placement, xM: 1, zM: -1 },
  };
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item: plain },
  });
  const plainTag = page
    .getByTestId("item-tag")
    .filter({ hasText: "plain item" });
  await expect(plainTag).toBeAttached();
  const plainPoint = projectToScreen({
    camera,
    viewport,
    pointM: { x: 1, y: 0.5, z: -1 },
  });
  await page.mouse.move(plainPoint.x, plainPoint.y);
  await expect(plainTag).toBeVisible();
  await page.mouse.click(plainPoint.x, plainPoint.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    JSON.stringify([plain.id]),
  );
  await expect(marker).toHaveCount(0);
  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+a");
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page
            .getByTestId("scene")
            .getAttribute("data-selected-items")) ?? "[]",
        ).length,
    )
    .toBe(2);
  await expect(marker).toHaveCount(0);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.remove", itemId: plain.id },
  });
  const lampPoint = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0, y: 1, z: 0 },
  });
  await page.mouse.click(lampPoint.x, lampPoint.y);
  await expect(marker).toBeVisible();
  expect(
    await page
      .locator("canvas")
      .first()
      .evaluate((canvas) =>
        canvas.contains(document.querySelector('[data-testid="bulb-marker"]')),
      ),
  ).toBe(false);
  const captured = await snapshot({
    page,
    path: testInfo.outputPath("with-marker.png"),
  });
  expect([...captured.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  await page.keyboard.press("Backslash");
  await expect(marker).toHaveCount(0);

  const walkLamp = {
    ...lamp,
    id: lamp.id,
    name: "Walk lamp",
    mirrored: false,
    sizeM: { width: 0.25, height: 2, depth: 0.25 },
    placement: { ...lamp.placement, zM: 1.3, rotationRad: 0 },
    light: {
      temperatureK: 2700,
      on: true,
      lumens: 1500,
      emitter: { x: 0.5, y: 0.8, z: 0.5 },
    },
  };
  for (const command of [
    {
      type: "item.update",
      itemId: lamp.id,
      patch: {
        name: walkLamp.name,
        sizeM: walkLamp.sizeM,
        placement: walkLamp.placement,
        light: walkLamp.light,
        mirrored: false,
      },
    },
    {
      type: "camera.set",
      camera: {
        positionM: { x: 0, y: 1.6, z: -1 },
        targetM: { x: 0, y: 1.6, z: 0.3 },
      },
    },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await page.keyboard.press("o");
  await page
    .getByRole("article", { name: "Walk lamp", exact: true })
    .getByText("Walk lamp", { exact: true })
    .click();
  await page.locator("canvas").first().focus();
  await page.keyboard.press("c");
  await expect(marker).toBeVisible();
  const walkBounds = await marker.boundingBox();
  if (!walkBounds) throw new Error("Missing walk bulb marker");
  expect(walkBounds.x + 12).toBeCloseTo(viewport.width / 2, 0);
  expect(walkBounds.y + 12).toBeCloseTo(viewport.height / 2, 0);
  const walkCamera = await page
    .getByTestId("scene")
    .getAttribute("data-camera");
  const countBeforeWalkDrag = updates.length;
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(walkBounds.x + 62, walkBounds.y - 18, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => updates.length).toBe(countBeforeWalkDrag + 1);
  const walkMoved = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === walkLamp.id);
  expect(walkMoved?.light?.emitter.x).toBeLessThan(0.5);
  expect(walkMoved?.light?.emitter.y).toBeGreaterThan(0.8);
  expect(walkMoved?.placement).toEqual(walkLamp.placement);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    walkCamera ?? "",
  );
  const beforeCancel = await readLightingFrame({ page });
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(walkBounds.x, walkBounds.y + 50, { steps: 5 });
  await expect
    .poll(async () => !(await readLightingFrame({ page })).equals(beforeCancel))
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(updates).toHaveLength(countBeforeWalkDrag + 1);
  await expect(marker).toBeVisible();
  await expect
    .poll(async () => (await readLightingFrame({ page })).equals(beforeCancel))
    .toBe(true);
  if (!walkMoved?.light) throw new Error("Missing moved light");
  const beforeRemoval = await marker.boundingBox();
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(walkBounds.x + 30, walkBounds.y + 50, { steps: 5 });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.update", itemId: lamp.id, patch: { light: null } },
  });
  await expect(marker).toHaveCount(0);
  await page.mouse.up();
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: lamp.id,
      patch: { light: walkMoved.light },
    },
  });
  await expect(marker).toBeVisible();
  await expect
    .poll(async () => (await marker.boundingBox())?.x)
    .toBeCloseTo(beforeRemoval?.x ?? -1, 0);
  await expect
    .poll(async () => (await marker.boundingBox())?.y)
    .toBeCloseTo(beforeRemoval?.y ?? -1, 0);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Escape");
  const wallLight = {
    ...walkMoved.light,
    on: false,
    emitter: { x: 0.5, y: 0.5, z: 0.5 },
  };
  for (const command of [
    {
      type: "item.update",
      itemId: lamp.id,
      patch: {
        placement: {
          kind: "wall",
          wallId: "wall-3",
          alongM: 2,
          heightM: 1.6,
          rotationRad: 0,
        },
        sizeM: { width: 0.3, height: 0.3, depth: 0.3 },
        light: wallLight,
      },
    },
    {
      type: "camera.set",
      camera: {
        positionM: { x: 0, y: 2, z: 0 },
        targetM: { x: 1.85, y: 1.6, z: 0 },
      },
    },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "walk lamp" }),
  ).toHaveAttribute("data-load-in-stage", "done");
  const wallCamera = JSON.parse(
    (await page.getByTestId("scene").getAttribute("data-camera")) ?? "{}",
  );
  const wallPoint = projectToScreen({
    camera: wallCamera,
    viewport,
    pointM: { x: 1.85, y: 1.6, z: 0 },
  });
  await page.mouse.click(wallPoint.x, wallPoint.y);
  await page.locator("canvas").first().focus();
  await expect(marker).toBeVisible();
  const wallBounds = await marker.boundingBox();
  if (!wallBounds) throw new Error("Missing wall bulb marker");
  const beforeHiding = updates.length;
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(wallBounds.x + 25, wallBounds.y - 15, { steps: 5 });
  await page.keyboard.press("Shift+Digit0");
  await expect(marker).toBeHidden();
  await page.mouse.up();
  expect(updates).toHaveLength(beforeHiding);
  const hiddenLamp = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  ).scene.items.find((item) => item.id === lamp.id);
  expect(hiddenLamp?.light?.emitter).toEqual(wallLight.emitter);
});

test("user lamps show bulb guides in a temporary project copy", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const source = process.env.PLANNER_A24_PROJECT;
  test.skip(
    !source,
    "Set PLANNER_A24_PROJECT to capture the user's lamp evidence",
  );
  if (!source) return;
  const project = ProjectSchema.parse(
    JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
  );
  const copy = join(isolatedRoot(), "projects", project.id);
  mkdirSync(copy, { recursive: true });
  cpSync(join(source, "assets"), join(copy, "assets"), { recursive: true });
  writeFileSync(join(copy, "project.json"), JSON.stringify(project));
  const evidence = "docs/work-packages/evidence";
  mkdirSync(evidence, { recursive: true });
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  for (const entry of [
    { pattern: /mushroom/i, name: "mushroom" },
    { pattern: /floor lamp/i, name: "arc-floor-lamp" },
  ]) {
    const item = project.scene.items.find((candidate) =>
      entry.pattern.test(candidate.name),
    );
    if (!item?.light) throw new Error(`Missing light for ${entry.name}`);
    await page.locator("canvas").first().focus();
    await page.keyboard.press("o");
    await page
      .getByRole("article", { name: item.name, exact: true })
      .getByText(item.name, { exact: true })
      .click();
    await page.locator("canvas").first().focus();
    await page.keyboard.press("c");
    const placement = item.placement;
    if (placement.kind !== "floor") throw new Error("Expected floor lamp");
    const targetM = {
      x: placement.xM,
      y: placement.elevationM + item.sizeM.height / 2,
      z: placement.zM,
    };
    await page.keyboard.press("Shift+Digit2");
    await expect
      .poll(async () => {
        const report = JSON.parse(
          (await page.getByTestId("scene").getAttribute("data-camera")) ?? "{}",
        );
        return report.targetM
          ? Math.hypot(
              report.targetM.x - targetM.x,
              report.targetM.y - targetM.y,
              report.targetM.z - targetM.z,
            )
          : Infinity;
      })
      .toBeLessThan(0.001);
    await expect(page.getByTestId("bulb-marker")).toBeVisible();
    await page.screenshot({ path: join(evidence, `a24-${entry.name}.png`) });
  }
});
