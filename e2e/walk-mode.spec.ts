import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, type Page, test } from "@playwright/test";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const evidenceDir =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a13-evidence";
const orbit = {
  positionM: { x: 0, y: 3, z: 6 },
  targetM: { x: 0, y: 0.8, z: 0 },
};

async function readCamera(page: Page) {
  return CameraSchema.parse(
    JSON.parse(
      (await page.getByTestId("scene").getAttribute("data-camera")) ?? "null",
    ),
  );
}
async function openRoom(page: Page) {
  const project = await createProject({
    name: "Walk room",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  for (const command of [
    { type: "camera.set", camera: orbit },
    {
      type: "surface.update",
      surfaceId: "ceiling",
      color: "#cc4433",
      material: { kind: "paint", color: "#cc4433", finish: "matte" },
    },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
  return project.id;
}
async function hold(options: { page: Page; key: string; durationMs?: number }) {
  await options.page.keyboard.down(options.key);
  await options.page.waitForTimeout(options.durationMs ?? 400);
  await options.page.keyboard.up(options.key);
}
async function enter(page: Page) {
  await page.keyboard.press("w");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await expect.poll(async () => (await readCamera(page)).positionM.y).toBe(1.6);
}

test("walk moves at eye height, stops at walls, clamps Q/E and restores orbit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openRoom(page);
  const before = await readCamera(page);
  await enter(page);
  expect((await readCamera(page)).positionM).toEqual({ x: 0, y: 1.6, z: 0 });
  const snap = await page
    .getByRole("button", { name: "snapS", exact: true })
    .getAttribute("aria-pressed");
  for (const entry of [
    { key: "w", axis: "z", sign: -1 },
    { key: "s", axis: "z", sign: 1 },
    { key: "a", axis: "x", sign: -1 },
    { key: "d", axis: "x", sign: 1 },
  ]) {
    const start = (await readCamera(page)).positionM;
    await hold({ page, key: entry.key });
    const after = (await readCamera(page)).positionM;
    expect(
      (entry.axis === "x" ? after.x - start.x : after.z - start.z) * entry.sign,
    ).toBeGreaterThan(0.05);
    expect(after.y).toBe(1.6);
    await expect(page.getByTestId("scene")).toHaveAttribute(
      "data-navigation",
      "walk",
    );
  }
  await expect(
    page.getByRole("button", { name: "snapS", exact: true }),
  ).toHaveAttribute("aria-pressed", snap ?? "true");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    await page.keyboard.down(key);
    await expect
      .poll(
        async () => {
          const before = (await readCamera(page)).positionM;
          await page.waitForTimeout(200);
          const after = (await readCamera(page)).positionM;
          const distanceM = Math.hypot(after.x - before.x, after.z - before.z);
          const atBoundary =
            key === "ArrowUp"
              ? after.z < -1.85
              : key === "ArrowDown"
                ? after.z > 1.85
                : key === "ArrowLeft"
                  ? after.x < -1.85
                  : after.x > 1.85;
          return atBoundary && distanceM < 1e-10;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.keyboard.up(key);
    const position = (await readCamera(page)).positionM;
    expect(Math.abs(position.x)).toBeLessThanOrEqual(1.88);
    expect(Math.abs(position.z)).toBeLessThanOrEqual(1.88);
    const atWall = await readCamera(page);
    await hold({ page, key, durationMs: 400 });
    const stopped = (await readCamera(page)).positionM;
    expect(stopped.x).toBeCloseTo(atWall.positionM.x, 12);
    expect(stopped.y).toBeCloseTo(atWall.positionM.y, 12);
    expect(stopped.z).toBeCloseTo(atWall.positionM.z, 12);
  }
  await page.keyboard.down("q");
  await expect.poll(async () => (await readCamera(page)).positionM.y).toBe(0.9);
  await page.keyboard.up("q");
  await page.keyboard.down("e");
  await expect.poll(async () => (await readCamera(page)).positionM.y).toBe(1.9);
  await page.keyboard.up("e");
  const walking = await readCamera(page);
  for (const key of ["Shift+0", "Shift+1", "Shift+2", "Meta+0", "f"])
    await page.keyboard.press(key);
  expect(await readCamera(page)).toEqual(walking);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "orbit",
  );
  await expect.poll(() => readCamera(page)).toEqual(before);
});

test("look, lens, painted ceiling and a 2x snapshot", async ({ page }) => {
  await openRoom(page);
  await page.getByRole("button", { name: "Walk mode", exact: true }).click();
  const initial = await readCamera(page);
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "walk-room.png") });
  const canvas = page.locator("canvas").first();
  const initialFov = Number(await canvas.getAttribute("data-fov"));
  const lens = page.getByRole("slider", { name: "Lens focal length" });
  await lens.fill("16");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fov")))
    .toBeGreaterThan(initialFov);
  await lens.fill("50");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fov")))
    .toBeLessThan(initialFov);
  await page.mouse.move(720, 650);
  await page.mouse.down();
  await page.mouse.move(740, 280, { steps: 15 });
  await page.mouse.up();
  const looking = await readCamera(page);
  expect(looking.positionM).toEqual(initial.positionM);
  expect(looking.targetM.y).toBeGreaterThan(looking.positionM.y + 0.9);
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "walk-ceiling.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Meta+Shift+s");
  const download = await downloadPromise;
  const snapshotPath = join(evidenceDir, "walk-snapshot.png");
  await download.saveAs(snapshotPath);
  const png = await readFile(snapshotPath);
  expect(png.readUInt32BE(16)).toBe(2880);
  expect(png.readUInt32BE(20)).toBe(1800);
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas context");
      context.drawImage(bitmap, 0, 0);
      return [
        ...context.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data,
      ];
    },
    [...png],
  );
  expect(pixels.at(0)).toBeGreaterThan((pixels.at(1) ?? 255) * 1.5);
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.getByText("W A S D / Arrow keys")).toBeVisible();
  await expect(sheet.getByText("Hold right mouse + W A S D")).toHaveCount(0);
  await page.screenshot({ path: join(evidenceDir, "walk-shortcuts.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await page.getByRole("button", { name: "Walk mode", exact: true }).click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "orbit",
  );
});

test("typing, focus changes, blur and touch gestures", async ({ page }) => {
  await openRoom(page);
  await enter(page);
  const before = await readCamera(page);
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.keyboard.type("wasd qe");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
    await page.keyboard.press(key);
  expect(await readCamera(page)).toEqual(before);
  const canvas = page.locator("canvas").first();
  await canvas.focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const stopped = await readCamera(page);
  await page.waitForTimeout(300);
  expect(await readCamera(page)).toEqual(stopped);
  await page.keyboard.up("w");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 700, y: 400, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 800, y: 450, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await readCamera(page)).targetM)
    .not.toEqual(stopped.targetM);
  const looked = await readCamera(page);
  expect(looked.positionM).toEqual(stopped.positionM);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 700, y: 400, id: 0 },
      { x: 800, y: 400, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 700, y: 300, id: 0 },
      { x: 800, y: 300, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .not.toEqual(looked.positionM);
  expect((await readCamera(page)).positionM.y).toBe(1.6);
});

test("surface edits preserve walk framing and Escape on the lens stays in walk", async ({
  page,
}) => {
  const projectId = await openRoom(page);
  const before = await readCamera(page);
  await enter(page);
  await hold({ page, key: "w" });
  await hold({ page, key: "q" });
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(820, 500, { steps: 10 });
  await page.mouse.up();
  const lens = page.getByRole("slider", { name: "Lens focal length" });
  await lens.fill("16");
  const camera = await readCamera(page);
  const canvas = page.locator("canvas").first();
  const fov = await canvas.getAttribute("data-fov");
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#446644",
      material: { kind: "paint", color: "#446644", finish: "matte" },
    },
  });
  await expect
    .poll(
      async () =>
        ProjectSchema.parse(
          await sendDaemonCommand({ type: "project.open", projectId }),
        ).scene.room.surfaces.floor?.color,
    )
    .toBe("#446644");
  await page.waitForTimeout(300);
  expect(await readCamera(page)).toEqual(camera);
  await expect(canvas).toHaveAttribute("data-fov", fov ?? "");
  expect(
    ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId }),
    ).scene.camera,
  ).toEqual(orbit);
  await page.screenshot({ path: join(evidenceDir, "walk-room.png") });
  await lens.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "orbit",
  );
  await expect.poll(() => readCamera(page)).toEqual(before);
});

test("a held nudge commits on entry; Shift+F10, Esc from a tab list and resizing in walk", async ({
  page,
}) => {
  const projectId = await openRoom(page);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: {
      type: "item.add",
      item: {
        id: "walk-table",
        name: "Walk table",
        model: { kind: "pending", jobId: "walk-job" },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
        locked: false,
      },
    },
  });
  await expect(page.getByTestId("item-tag")).toBeAttached();
  const point = projectToScreen({
    camera: await readCamera(page),
    pointM: { x: 0, y: 0.25, z: 0 },
    viewport: page.viewportSize() ?? { width: 1440, height: 900 },
  });
  await page.mouse.click(point.x, point.y);
  const inspectorHeading = page.getByRole("heading", {
    name: "Walk table",
    exact: true,
  });
  await expect(inspectorHeading).toBeVisible();
  await page.locator("canvas").first().focus();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.down("w");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowRight");
  await expect
    .poll(async () => {
      const placement = ProjectSchema.parse(
        await sendDaemonCommand({ type: "project.open", projectId }),
      ).scene.items.at(0)?.placement;
      return placement?.kind === "floor" ? placement.xM : 0;
    })
    .not.toBe(0);
  await page.keyboard.press("Shift+F10");
  await page.waitForTimeout(200);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.evaluate(() => {
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    list.tabIndex = -1;
    list.dataset.testid = "walk-escape-target";
    document.body.append(list);
    list.focus();
  });
  await page.keyboard.press("Escape");
  await page
    .getByTestId("walk-escape-target")
    .evaluate((element) => element.remove());
  await expect(inspectorHeading).toHaveCount(0);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  const canvas = page.locator("canvas").first();
  const fov = await canvas.getAttribute("data-fov");
  await page.setViewportSize({ width: 800, height: 1200 });
  await expect(canvas).not.toHaveAttribute("data-fov", fov ?? "");
});

test("dragging the lens returns focus to the canvas so W moves", async ({
  page,
}) => {
  await openRoom(page);
  await enter(page);
  const canvas = page.locator("canvas").first();
  const fov = Number(await canvas.getAttribute("data-fov"));
  const box = await page
    .getByRole("slider", { name: "Lens focal length" })
    .boundingBox();
  if (!box) throw new Error("Missing lens slider");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fov")))
    .toBeGreaterThan(fov);
  const start = (await readCamera(page)).positionM;
  await hold({ page, key: "w" });
  expect((await readCamera(page)).positionM.z).toBeLessThan(start.z - 0.05);
});

test("held W enters without moving, Escape closes a popover first, touch-action and room changes", async ({
  page,
}) => {
  const projectId = await openRoom(page);
  const canvas = page.locator("canvas").first();
  const orbitTouchAction = await canvas.evaluate(
    (element) => getComputedStyle(element).touchAction,
  );
  await canvas.focus();
  await page.keyboard.down("w");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  const entered = await readCamera(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  expect(await readCamera(page)).toEqual(entered);
  expect(
    await canvas.evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe("none");
  await page.getByTestId("room-size").click();
  const roomPanel = page.getByRole("dialog", { name: "Room", exact: true });
  await expect(roomPanel).toBeVisible();
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(roomPanel).toHaveCount(0);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: {
      type: "room.update",
      walls: createRectangularScene({
        widthM: 8,
        depthM: 6,
        ceilingHeightM: 1.6,
      }).room.walls,
      ceilingHeightM: 1.6,
    },
  });
  await expect
    .poll(async () => (await readCamera(page)).positionM.y)
    .toBeCloseTo(1.5, 6);
  await hold({ page, key: "e" });
  expect((await readCamera(page)).positionM.y).toBeCloseTo(1.5, 6);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "orbit",
  );
  expect(
    await canvas.evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe(orbitTouchAction);
  const framed = await readCamera(page);
  expect(framed).not.toEqual(orbit);
  await expect
    .poll(
      async () =>
        ProjectSchema.parse(
          await sendDaemonCommand({ type: "project.open", projectId }),
        ).scene.camera,
    )
    .toEqual(framed);
});

test("entering during orbit easing restores and saves a stationary orbit pose", async ({
  page,
}) => {
  const projectId = await openRoom(page);
  await page.locator("canvas").first().focus();
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "w",
        bubbles: true,
        cancelable: true,
      }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keyup", { key: "w", bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "orbit",
  );
  const restored = await readCamera(page);
  await page.waitForTimeout(500);
  expect(await readCamera(page)).toEqual(restored);
  await expect
    .poll(
      async () =>
        ProjectSchema.parse(
          await sendDaemonCommand({ type: "project.open", projectId }),
        ).scene.camera,
    )
    .toEqual(restored);
});

test("Escape in walk clears a selected object before leaving, and Deselect closes the inspector", async ({
  page,
}) => {
  const projectId = await openRoom(page);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: {
      type: "item.add",
      item: {
        id: "walk-stool",
        name: "Walk stool",
        model: { kind: "pending", jobId: "walk-stool-job" },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
        locked: false,
      },
    },
  });
  await expect(page.getByTestId("item-tag")).toBeAttached();
  const point = projectToScreen({
    camera: await readCamera(page),
    pointM: { x: 0, y: 0.25, z: 0 },
    viewport: page.viewportSize() ?? { width: 1440, height: 900 },
  });
  const inspectorHeading = page.getByRole("heading", {
    name: "Walk stool",
    exact: true,
  });
  await page.mouse.click(point.x, point.y);
  await expect(inspectorHeading).toBeVisible();
  await page.locator("canvas").first().focus();
  await enter(page);
  await page.keyboard.press("Escape");
  await expect(inspectorHeading).toHaveCount(0);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-navigation",
    "walk",
  );
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .toEqual(orbit.positionM);
  await page.mouse.click(point.x, point.y);
  await expect(inspectorHeading).toBeVisible();
  await page.getByRole("button", { name: "Deselect" }).click();
  await expect(inspectorHeading).toHaveCount(0);
});
