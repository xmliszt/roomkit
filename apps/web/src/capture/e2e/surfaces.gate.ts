import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import {
  type Camera,
  CameraSchema,
} from "@planner/shared/src/scene/camera-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 7, y: 6, z: 8 },
  targetM: { x: 0, y: 0.8, z: 0 },
};
const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a11-evidence";

async function saved(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
}

async function setCamera(options: {
  page: Page;
  projectId: string;
  camera: Camera;
}) {
  const url = options.page.url();
  await options.page.goto("about:blank");
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: options.projectId,
    command: { type: "camera.set", camera: options.camera },
  });
  await options.page.goto(url);
  await expect
    .poll(
      async () =>
        CameraSchema.safeParse(
          JSON.parse(
            (await options.page
              .getByTestId("scene")
              .getAttribute("data-camera", { timeout: 15000 })) ?? "{}",
          ),
        ).data,
      { timeout: 15000 },
    )
    .toEqual(options.camera);
}

async function pixels(options: {
  page: Page;
  points: { x: number; y: number }[];
}) {
  const png = await options.page.screenshot();
  return options.page.evaluate(
    async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([
          Uint8Array.from(atob(input.png), (char) => char.charCodeAt(0)),
        ]),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No pixel context");
      context.drawImage(bitmap, 0, 0);
      return input.points.map((point) =>
        Array.from(
          context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1)
            .data,
        ).slice(0, 3),
      );
    },
    { png: png.toString("base64"), points: options.points },
  );
}

test("surface materials repeat in metres, paint previews commit once, walls undo and ceiling shows inside", async ({
  page,
}) => {
  mkdirSync(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404"))
      errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  const project = await createProject({
    name: "Surface materials",
    widthM: 4.8,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#e8dfcf",
      material: {
        kind: "tiles",
        tileSizeM: { u: 0.8, v: 0.8 },
        groutWidthM: 0.02,
        groutColor: "#444444",
        baseColor: "#e8dfcf",
        roughness: 0.25,
      },
    },
  });
  await page.goto(`/projects/${project.id}`);
  const above = {
    positionM: { x: 0.2, y: 7, z: 0.2 },
    targetM: { x: 0, y: 0, z: 0 },
  };
  await setCamera({ page, projectId: project.id, camera: above });
  const ceilingFootprint = projectToScreen({
    camera: above,
    viewport,
    pointM: { x: 0, y: 2.6, z: 0 },
  });
  await page.mouse.dblclick(ceilingFootprint.x, ceilingFootprint.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-surface",
    "floor",
  );
  await page.keyboard.press("Escape");
  await setCamera({ page, projectId: project.id, camera });
  const lineA = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0, y: 0, z: 0.23 },
  });
  const lineB = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0.8, y: 0, z: 0.23 },
  });
  const between = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0.4, y: 0, z: 0.23 },
  });
  const samplePoints = Array.from({ length: 121 }, (_, index) => ({
    x: lineA.x + ((lineB.x - lineA.x) * (index - 10)) / 100,
    y: lineA.y + ((lineB.y - lineA.y) * (index - 10)) / 100,
  }));
  const row = await pixels({ page, points: samplePoints });
  const dark = row.map((rgb, index) => ({
    index,
    brightness: rgb.reduce((a, b) => a + b, 0) / 3,
  }));
  const first = dark
    .slice(0, 21)
    .toSorted((a, b) => a.brightness - b.brightness)
    .at(0);
  const second = dark
    .slice(100)
    .toSorted((a, b) => a.brightness - b.brightness)
    .at(0);
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  const distancePx = Math.hypot(lineB.x - lineA.x, lineB.y - lineA.y);
  const measuredPx =
    (((second?.index ?? 0) - (first?.index ?? 0)) / 100) * distancePx;
  expect(Math.abs(measuredPx - distancePx)).toBeLessThan(3);
  const [tile] = await pixels({ page, points: [between] });
  expect(tile?.at(0)).toBeGreaterThan((first?.brightness ?? 255) + 50);
  await page.mouse.click(between.x, between.y);
  await expect(
    page.getByRole("dialog", { name: "Room", exact: true }),
  ).toBeHidden();
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-selected-surface",
  );
  await page.mouse.dblclick(between.x, between.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-surface",
    "floor",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-selected-surface",
  );
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill("select ceiling");
  await page.getByLabel("Search commands").press("Enter");
  await expect(
    page.getByRole("button", { name: "ceiling", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "wall 4", exact: true }).click();
  await page.getByLabel("Material", { exact: true }).selectOption("paint");
  await page.getByRole("button", { name: "Sage", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Finish", exact: true })
    .selectOption("matte");
  await expect
    .poll(
      async () =>
        (await saved(project.id)).scene.room.surfaces["wall-4"]?.material,
    )
    .toEqual({ kind: "paint", color: "#9caf91", finish: "matte" });
  const beforePreview = (await saved(project.id)).revision;
  await page.getByLabel("Paint colour", { exact: true }).evaluate((element) => {
    if (!(element instanceof HTMLInputElement))
      throw new Error("No colour input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, "#779977");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect((await saved(project.id)).revision).toBe(beforePreview);
  await page
    .getByLabel("Paint colour", { exact: true })
    .dispatchEvent("change");
  await expect
    .poll(async () => (await saved(project.id)).revision)
    .toBe(beforePreview + 1);
  await page.getByRole("button", { name: "Sage", exact: true }).click();
  const beforeAll = (await saved(project.id)).scene.room.surfaces;
  await page.getByRole("button", { name: "Apply to all walls" }).click();
  await expect
    .poll(
      async () =>
        Object.values((await saved(project.id)).scene.room.surfaces).filter(
          (surface) => surface.material?.kind === "paint",
        ).length,
    )
    .toBe(4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await saved(project.id)).scene.room.surfaces)
    .toEqual(beforeAll);
  await page.keyboard.press("Meta+Shift+z");
  await expect
    .poll(
      async () =>
        Object.values((await saved(project.id)).scene.room.surfaces).filter(
          (surface) => surface.material?.kind === "paint",
        ).length,
    )
    .toBe(4);
  const wallPoint = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0, y: 1.5, z: -2 },
  });
  const [sage] = await pixels({ page, points: [wallPoint] });
  expect(sage?.at(1)).toBeGreaterThan((sage?.at(0) ?? 255) + 8);
  expect(sage?.at(1)).toBeGreaterThan((sage?.at(2) ?? 255) + 15);
  await page.screenshot({ path: join(evidence, "surfaces-above.png") });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "ceiling",
      color: "#fcfbf9",
      material: { kind: "paint", color: "#fcfbf9", finish: "matte" },
    },
  });
  const inside = {
    positionM: { x: 2.2, y: 2.2, z: 1.8 },
    targetM: { x: -1.8, y: 1.5, z: -1.8 },
  };
  await setCamera({ page, projectId: project.id, camera: inside });
  await page.screenshot({ path: join(evidence, "surfaces-inside.png") });
  const ceilingPoint = projectToScreen({
    camera: inside,
    viewport,
    pointM: { x: -2.2, y: 2.6, z: -1.8 },
  });
  await page.mouse.dblclick(ceilingPoint.x, ceilingPoint.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-surface",
    "ceiling",
  );
  const [ceiling] = await pixels({ page, points: [ceilingPoint] });
  expect(ceiling?.at(0)).toBeGreaterThan(180);
  expect(errors).toEqual([]);
});

test("texture maps retain metric repeats during numeric previews and the palette paints every wall", async ({
  page,
}) => {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated test home");
  const project = await createProject({
    name: "Texture repeats",
    widthM: 4.8,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await page.setViewportSize(viewport);
  const maps = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No texture context");
    return ["baseColor", "normal", "roughness"].map((kind) => {
      context.fillStyle =
        kind === "baseColor"
          ? "#dd4422"
          : kind === "normal"
            ? "#8080ff"
            : "#ffffff";
      context.fillRect(0, 0, 128, 128);
      if (kind === "baseColor") {
        context.fillStyle = "#2244dd";
        context.fillRect(64, 0, 64, 128);
      }
      return { kind, data: canvas.toDataURL().split(",").at(1) ?? "" };
    });
  });
  const folder = join(
    root,
    "projects",
    project.id,
    "assets",
    "surface-pattern",
  );
  mkdirSync(folder, { recursive: true });
  for (const map of maps)
    writeFileSync(
      join(folder, `${map.kind}.png`),
      Buffer.from(map.data, "base64"),
    );
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "surface-pattern",
      kind: "surface",
      color: "#ffffff",
      material: {
        kind: "texture",
        textureAssetId: "surface-pattern",
        repeatSizeM: { u: 0.8, v: 0.8 },
        roughness: 0.8,
      },
      provenance: { method: "surfacer", prompt: "fixture", sourcePhotoIds: [] },
    }),
  );
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#ffffff",
      material: {
        kind: "texture",
        textureAssetId: "surface-pattern",
        repeatSizeM: { u: 0.8, v: 0.8 },
        roughness: 0.8,
      },
    },
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "ceiling",
      color: "#ffffff",
      material: {
        kind: "texture",
        textureAssetId: "surface-pattern",
        repeatSizeM: { u: 0.25, v: 0.25 },
        roughness: 0.8,
      },
    },
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/assets/surface-pattern/"))
      requests.push(request.url());
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  await page.goto(`/projects/${project.id}`);
  const points = [0.1, 0.5, 0.9].map((x) =>
    projectToScreen({ camera, viewport, pointM: { x, y: 0, z: 0.23 } }),
  );
  await expect
    .poll(async () => {
      const [a, b, repeat] = await pixels({ page, points });
      return (
        !!a &&
        !!b &&
        !!repeat &&
        (a.at(0) ?? 0) > (a.at(2) ?? 255) + 80 &&
        (b.at(2) ?? 0) > (b.at(0) ?? 255) + 80 &&
        Math.abs((a.at(0) ?? 0) - (repeat.at(0) ?? 255)) < 8
      );
    })
    .toBe(true);
  expect(new Set(requests.map((url) => url.split("/").at(-1))).size).toBe(3);
  expect(requests).toHaveLength(3);
  const requestCount = requests.length;
  await page.getByTestId("room-size").click();
  await page.getByRole("button", { name: "floor", exact: true }).click();
  const width = page.getByLabel("Repeat width · m", { exact: true });
  const revision = (await saved(project.id)).revision;
  await width.focus();
  await width.press("Meta+a");
  await width.pressSequentially("0.6");
  await expect(width).toHaveValue("0.6");
  expect((await saved(project.id)).revision).toBe(revision);
  await width.press("Enter");
  await expect
    .poll(async () => (await saved(project.id)).revision)
    .toBe(revision + 1);
  await width.fill("1.2");
  await width.press("Escape");
  await expect(width).toHaveValue("0.6");
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#ffffff",
      material: {
        kind: "texture",
        textureAssetId: "surface-pattern",
        repeatSizeM: { u: 0.7, v: 0.8 },
        roughness: 0.8,
      },
    },
  });
  await expect(width).toHaveValue("0.7");
  await width.evaluate((element) => {
    if (element instanceof HTMLElement) element.blur();
  });
  await page.getByLabel("Roughness", { exact: true }).evaluate((element) => {
    if (!(element instanceof HTMLInputElement))
      throw new Error("No roughness input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    for (const value of ["0.2", "0.3", "0.4"]) {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(async () => (await saved(project.id)).revision)
    .toBe(revision + 3);
  expect(requests.length).toBe(requestCount);
  await page.screenshot({ path: join(evidence, "surfaces-texture.png") });
  await page.getByLabel("Material", { exact: true }).selectOption("tiles");
  await page.getByRole("combobox", { name: "Texture", exact: true }).click();
  await page
    .getByRole("option", { name: "Texture · 0.80 m", exact: true })
    .click();
  async function floorIsRed() {
    const [sample] = await pixels({
      page,
      points: [points.at(0) ?? { x: 0, y: 0 }],
    });
    return (sample?.at(0) ?? 0) > (sample?.at(2) ?? 255) + 80;
  }
  await expect.poll(floorIsRed).toBe(true);
  await page.getByRole("combobox", { name: "Texture", exact: true }).click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await expect.poll(floorIsRed).toBe(false);
  await page.getByRole("combobox", { name: "Texture", exact: true }).click();
  await page
    .getByRole("option", { name: "Texture · 0.80 m", exact: true })
    .click();
  await expect.poll(floorIsRed).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill("paint all walls");
  await page.getByLabel("Search commands").press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Paint all walls",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sage", exact: true }).click();
  expect(
    Object.keys((await saved(project.id)).scene.room.surfaces).toSorted(),
  ).toEqual(["ceiling", "floor"]);
  await page.screenshot({
    path: join(evidence, "surfaces-paint-controls.png"),
  });
  await dialog.getByRole("button", { name: "Apply to all walls" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        Object.values((await saved(project.id)).scene.room.surfaces).filter(
          (surface) => surface.material?.kind === "paint",
        ).length,
    )
    .toBe(4);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () =>
      Object.keys((await saved(project.id)).scene.room.surfaces).toSorted(),
    )
    .toEqual(["ceiling", "floor"]);
});

test("surface rows name UUID walls by room order and truncate without wrapping", async ({
  page,
}) => {
  const project = await createProject({
    name: "Surface names",
    widthM: 5.6,
    depthM: 3.4,
    ceilingHeightM: 2.6,
  });
  const walls = project.scene.room.walls.map((wall) => ({
    ...wall,
    id: randomUUID(),
  }));
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "room.update", walls },
  });
  const firstWall = walls.at(0);
  if (!firstWall) throw new Error("No fixture wall");
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: firstWall.id,
      color: "#9caf91",
    },
  });
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  await page.getByTestId("room-size").click();
  const panel = page.getByRole("dialog", { name: "Room", exact: true });
  const rows = panel.getByTestId("surface-row");
  await expect(rows).toHaveCount(6);
  await expect(rows.locator("button[aria-pressed]")).toHaveText([
    "floor",
    "ceiling",
    "wall 1 · 3.40 m",
    "wall 2 · 5.60 m",
    "wall 3 · 3.40 m",
    "wall 4 · 5.60 m",
  ]);
  for (const [index, wall] of walls.entries()) {
    const label = `wall ${index + 1}`;
    await panel.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByTestId("scene")).toHaveAttribute(
      "data-selected-surface",
      wall.id,
    );
    await expect(
      panel.getByLabel(`${label} colour`, { exact: true }),
    ).toBeVisible();
    const labels = await panel.evaluate((element) =>
      [
        element.textContent,
        ...Array.from(
          element.querySelectorAll("[aria-label], [title]"),
          (child) =>
            `${child.getAttribute("aria-label")} ${child.getAttribute("title")}`,
        ),
      ].join(" "),
    );
    expect(labels).not.toContain(wall.id);
  }
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "room.update",
      walls: walls.map((wall, index) =>
        index === 1 ? { ...wall, kind: "open" } : wall,
      ),
    },
  });
  await expect(rows).toHaveCount(5);
  await expect(
    panel.getByRole("button", { name: "wall 2", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "wall 3", exact: true }),
  ).toBeVisible();
  const row = rows.nth(2);
  await expect(
    row.getByRole("button", { name: "Reset wall 1 colour", exact: true }),
  ).toBeVisible();
  const label = row.getByRole("button", { name: "wall 1", exact: true });
  expect(
    await label
      .locator("span")
      .evaluate((element) => getComputedStyle(element).color),
  ).not.toBe(
    await label.evaluate((element) => getComputedStyle(element).color),
  );
  await panel.evaluate((element) => {
    element.style.width = "220px";
  });
  const layout = await row.evaluate((element) => {
    const children = Array.from(element.children);
    const label = children.at(0);
    if (!(label instanceof HTMLElement)) throw new Error("No surface label");
    const bounds = element.getBoundingClientRect();
    return {
      whiteSpace: getComputedStyle(label).whiteSpace,
      textOverflow: getComputedStyle(label).textOverflow,
      overflow: getComputedStyle(label).overflowX,
      truncated: label.scrollWidth > label.clientWidth,
      aligned: children.every((child) => {
        const box = child.getBoundingClientRect();
        return (
          Math.abs(box.top + box.height / 2 - bounds.top - bounds.height / 2) <
            1 && box.right <= bounds.right + 1
        );
      }),
    };
  });
  expect(layout).toEqual({
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    overflow: "hidden",
    truncated: true,
    aligned: true,
  });
  await page.screenshot({ path: join(evidence, "surfaces-narrow-panel.png") });
});

for (const isStorageAvailable of [true, false]) {
  test(`floor grid toggles pixels independently of snap with storage ${isStorageAvailable ? "available" : "unavailable"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (!isStorageAvailable) {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("Storage unavailable");
          },
        });
      });
    }
    const project = await createProject({
      name: "Floor grid",
      widthM: 4,
      depthM: 4,
      ceilingHeightM: 2.6,
    });
    await page.setViewportSize(viewport);
    await page.goto(`/projects/${project.id}`);
    await setCamera({ page, projectId: project.id, camera });
    const toggle = page.getByRole("button", { name: "gridG", exact: true });
    const snap = page.getByRole("button", { name: "snapS", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await toggle.getAttribute("class")).toBe(
      await snap.getAttribute("class"),
    );
    const point = projectToScreen({
      camera,
      viewport,
      pointM: { x: 0, y: 0.002, z: 0 },
    });
    const points = [-1, 0, 1].flatMap((x) =>
      [-1, 0, 1].map((y) => ({ x: point.x + x, y: point.y + y })),
    );
    async function darkestPixel() {
      const colors = await pixels({ page, points });
      return Math.min(
        ...colors.map(
          (color) => color.reduce((sum, channel) => sum + channel, 0) / 3,
        ),
      );
    }
    const onBrightness = await darkestPixel();
    await page.keyboard.press("g");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(darkestPixel).toBeGreaterThan(onBrightness + 20);
    await expect(snap).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Message" }).press("g");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({
      path: join(evidence, `grid-off-storage-${isStorageAvailable}.png`),
    });
    await page.reload();
    await expect(toggle).toHaveAttribute(
      "aria-pressed",
      String(!isStorageAvailable),
    );
    if (!isStorageAvailable) await toggle.click();
    await expect.poll(darkestPixel).toBeGreaterThan(onBrightness + 20);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(darkestPixel).toBeLessThan(onBrightness + 5);
    await page.getByRole("button", { name: /commands/ }).click();
    await page.getByLabel("Search commands").fill("grid");
    await page.getByLabel("Search commands").press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(snap).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });
}

test("Escape closes ordinary popovers without deselecting items and plain floor clicks clear selection", async ({
  page,
}) => {
  const project = await createProject({
    name: "Surface selection",
    widthM: 4.8,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "selection-table",
        name: "Selection table",
        model: { kind: "pending", jobId: "selection-job" },
        placement: {
          kind: "floor",
          xM: 0.5,
          zM: 0.5,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
        locked: false,
      },
    },
  });
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  await setCamera({ page, projectId: project.id, camera });
  const item = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0.5, y: 0.5, z: 0.5 },
  });
  await page.mouse.click(item.x, item.y);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Selection table");
  await page.getByTestId("room-size").click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Room", exact: true }),
  ).toBeHidden();
  await expect(inspector).toBeVisible();
  await page.getByTestId("project-title").click();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeVisible();
  const floor = projectToScreen({
    camera,
    viewport,
    pointM: { x: -0.8, y: 0, z: -0.8 },
  });
  await page.mouse.click(floor.x, floor.y);
  await expect(inspector).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "Room", exact: true }),
  ).toBeHidden();
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-selected-surface",
  );
  await page.mouse.dblclick(floor.x, floor.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-surface",
    "floor",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-selected-surface",
  );
});

test("undo and redo clear a live surface preview", async ({ page }) => {
  const project = await createProject({
    name: "Preview history",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByTestId("room-size").click();
  await page.getByRole("button", { name: "floor", exact: true }).click();
  await page.getByLabel("Material", { exact: true }).selectOption("tiles");
  const width = page.getByLabel("Repeat width · m", { exact: true });
  await width.fill("0.6");
  await width.press("Enter");
  await width.evaluate((element) => {
    if (element instanceof HTMLElement) element.blur();
  });
  async function previewRoughness() {
    await page.getByLabel("Roughness", { exact: true }).evaluate((element) => {
      if (!(element instanceof HTMLInputElement))
        throw new Error("No roughness input");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, "0.9");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.getByLabel("Roughness", { exact: true })).toHaveValue(
      "0.9",
    );
  }
  await previewRoughness();
  await page.keyboard.press("Meta+z");
  await expect(width).toHaveValue("0.8");
  await expect(page.getByLabel("Roughness", { exact: true })).toHaveValue(
    "0.3",
  );
  await previewRoughness();
  await page.keyboard.press("Meta+Shift+z");
  await expect(width).toHaveValue("0.6");
  await expect(page.getByLabel("Roughness", { exact: true })).toHaveValue(
    "0.3",
  );
});

test("synthetic wallpaper reads left to right on a wall without mirroring", async ({
  page,
}) => {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated test home");
  const project = await createProject({
    name: "B15 wallpaper orientation",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const source = readFileSync(
    new URL("./fixtures/b15-wallpaper.png", import.meta.url),
  );
  const folder = join(root, "projects", project.id, "assets", "b15-wallpaper");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "baseColor.png"), source);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "surface.update",
      surfaceId: "wall-4",
      color: "#ffffff",
      material: {
        kind: "texture",
        textureAssetId: "b15-wallpaper",
        repeatSizeM: { u: 2, v: 2 },
        roughness: 0.55,
      },
    },
  });
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  const front = {
    positionM: { x: -1, y: 1.6, z: 1.5 },
    targetM: { x: -1, y: 1.1, z: -2 },
  };
  await setCamera({ page, projectId: project.id, camera: front });
  const samples = Array.from(
    { length: 8 },
    (_, column) => column / 10 + 0.15,
  ).flatMap((u) =>
    Array.from({ length: 8 }, (_, row) => ({ u, v: row / 10 + 0.15 })),
  );
  const expected = await page.evaluate(
    async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([
          Uint8Array.from(atob(input.image), (character) =>
            character.charCodeAt(0),
          ),
        ]),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No fixture image context");
      context.drawImage(bitmap, 0, 0);
      function brightness(options: { u: number; v: number }) {
        const values = context?.getImageData(
          Math.round(options.u * (bitmap.width - 1)),
          Math.round((1 - options.v) * (bitmap.height - 1)),
          1,
          1,
        ).data;
        if (!values) throw new Error("Missing fixture pixel");
        return (
          ((values.at(0) ?? 0) + (values.at(1) ?? 0) + (values.at(2) ?? 0)) / 3
        );
      }
      return {
        forward: input.samples.map(brightness),
        mirrored: input.samples.map((point) =>
          brightness({ u: 1 - point.u, v: point.v }),
        ),
      };
    },
    { image: source.toString("base64"), samples },
  );
  const points = samples.map((point) =>
    projectToScreen({
      camera: front,
      viewport,
      pointM: { x: -2 + 2 * point.u, y: 2 * point.v, z: -2 },
    }),
  );
  function correlation(options: { a: number[]; b: number[] }) {
    const averageA =
      options.a.reduce((sum, value) => sum + value, 0) / options.a.length;
    const averageB =
      options.b.reduce((sum, value) => sum + value, 0) / options.b.length;
    const a = options.a.map((value) => value - averageA);
    const b = options.b.map((value) => value - averageB);
    return (
      a.reduce((sum, value, index) => sum + value * (b.at(index) ?? 0), 0) /
      Math.sqrt(
        a.reduce((sum, value) => sum + value * value, 0) *
          b.reduce((sum, value) => sum + value * value, 0),
      )
    );
  }
  async function compare() {
    const values = (await pixels({ page, points })).map(
      (color) => color.reduce((sum, value) => sum + value, 0) / 3,
    );
    return {
      forward: correlation({ a: values, b: expected.forward }),
      mirrored: correlation({ a: values, b: expected.mirrored }),
    };
  }
  await expect.poll(async () => (await compare()).forward).toBeGreaterThan(0.8);
  const result = await compare();
  expect(result.forward - result.mirrored).toBeGreaterThan(0.2);
  writeFileSync(
    join(evidence, "b15-wallpaper-orientation.json"),
    JSON.stringify(result, undefined, 2),
  );
  await page.screenshot({ path: join(evidence, "b15-wallpaper-wall.png") });
  const wallPoint = projectToScreen({
    camera: front,
    viewport,
    pointM: { x: -1, y: 1, z: -2 },
  });
  await page.mouse.dblclick(wallPoint.x, wallPoint.y);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-surface",
    "wall-4",
  );
});
