import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { getWallSegments } from "../apps/web/src/room/get-wall-segments.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 5, y: 4.5, z: 6.5 },
  targetM: { x: 0, y: 0.8, z: 0 },
};

async function savedProject(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
}

async function shownCamera(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-camera");
  return value === null ? undefined : CameraSchema.parse(JSON.parse(value));
}

function findPort(items: Item[]) {
  const port = items.find((item) => item.name === "Charging port");
  if (port === undefined || port.placement.kind !== "wall") {
    throw new Error("no charging port on a wall");
  }
  return { ...port, placement: port.placement };
}

function portFront(options: {
  room: Room;
  port: ReturnType<typeof findPort>;
  camera: Camera;
}) {
  const segment = getWallSegments(options.room).find(
    (candidate) => candidate.wall.id === options.port.placement.wallId,
  );
  if (segment === undefined) throw new Error("the port's wall is gone");
  const outM = options.port.sizeM.depth;
  return projectToScreen({
    camera: options.camera,
    viewport,
    pointM: {
      x:
        segment.startM.x +
        segment.direction.x * options.port.placement.alongM -
        segment.outward.x * outM,
      y: options.port.placement.heightM,
      z:
        segment.startM.z +
        segment.direction.z * options.port.placement.alongM -
        segment.outward.z * outM,
    },
  });
}

async function readPixels(options: {
  page: Page;
  png: Buffer;
  region: "centre" | "all";
}) {
  return options.page.evaluate(
    async (input) => {
      const bytes = Uint8Array.from(atob(input.base64), (char) =>
        char.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const side = input.region === "centre" ? 8 : undefined;
      const x = side === undefined ? 0 : bitmap.width / 2 - side / 2;
      const y = side === undefined ? 0 : bitmap.height / 2 - side / 2;
      const { data } = context.getImageData(
        x,
        y,
        side ?? bitmap.width,
        side ?? bitmap.height,
      );
      const count = data.length / 4;
      const mean = [0, 1, 2].map((channel) => {
        let sum = 0;
        for (let index = channel; index < data.length; index += 4) {
          sum += data[index] ?? 0;
        }
        return sum / count;
      });
      let lumaSum = 0;
      let lumaSquareSum = 0;
      for (let index = 0; index < data.length; index += 4) {
        const luma =
          0.3 * (data[index] ?? 0) +
          0.59 * (data[index + 1] ?? 0) +
          0.11 * (data[index + 2] ?? 0);
        lumaSum += luma;
        lumaSquareSum += luma * luma;
      }
      const lumaMean = lumaSum / count;
      return {
        width: bitmap.width,
        height: bitmap.height,
        red: mean[0] ?? 0,
        green: mean[1] ?? 0,
        blue: mean[2] ?? 0,
        lumaVariance: lumaSquareSum / count - lumaMean * lumaMean,
      };
    },
    { base64: options.png.toString("base64"), region: options.region },
  );
}

async function blurAndDeselect(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toBeHidden();
}

test("the advanced panel places a port by numbers, survives a room resize and reload, snapshots, exports, imports and colorizes", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  const created = await createProject({
    name: "Advanced panel",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const projectId = created.id;
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: { type: "camera.set", camera },
  });
  await page.goto(`/projects/${projectId}`);
  await expect.poll(() => shownCamera(page)).toEqual(camera);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("option", { name: /Charging port/ })
    .first()
    .click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Charging port");
  const along = inspector.getByLabel("along");
  await along.fill("1.2");
  await along.press("Enter");
  const aboveFloor = inspector.getByLabel("above floor");
  await aboveFloor.fill("abc");
  await expect(aboveFloor).toHaveAttribute("aria-invalid", "true");
  await aboveFloor.press("Escape");
  await expect(aboveFloor).toHaveAttribute("aria-invalid", "false");
  await aboveFloor.fill("0.3");
  await aboveFloor.press("Enter");
  await expect
    .poll(async () => {
      const port = findPort((await savedProject(projectId)).scene.items);
      return [port.placement.alongM, port.placement.heightM];
    })
    .toEqual([1.2, 0.3]);
  const placed = findPort((await savedProject(projectId)).scene.items);
  await page.screenshot({ path: testInfo.outputPath("inspector.png") });
  const width0 = inspector.getByLabel("width");
  await expect(width0).toHaveValue("0.09");
  await width0.fill("0.090");
  await width0.press("Enter");
  await expect
    .poll(
      async () =>
        findPort((await savedProject(projectId)).scene.items).sizeM.width,
    )
    .toBe(0.09);

  await page.getByTestId("room-size").click();
  const roomPanel = page.getByRole("dialog", { name: "Room" });
  await expect(roomPanel).toBeVisible();
  const width = roomPanel.getByLabel("width");
  await expect(width).toHaveValue("4.00");
  await width.fill("5");
  await width.press("Enter");
  await width.fill("7");
  await width.press("Escape");
  await expect(width).toHaveValue("5.00");
  await expect(page.getByTestId("room-size")).toHaveText(
    "5.00 × 4.00 × 2.60 m",
  );
  await page.screenshot({ path: testInfo.outputPath("room-panel.png") });
  await expect
    .poll(async () => {
      const saved = await savedProject(projectId);
      const xs = saved.scene.room.walls.map((wall) => wall.startM.x);
      return Math.max(...xs) - Math.min(...xs);
    })
    .toBe(5);
  const ceiling = roomPanel.getByLabel("ceiling", { exact: true });
  await ceiling.fill("2.75");
  await ceiling.press("Enter");
  await expect(page.getByTestId("room-size")).toHaveText(
    "5.00 × 4.00 × 2.75 m",
  );
  await expect
    .poll(async () => (await savedProject(projectId)).scene.room.ceilingHeightM)
    .toBe(2.75);
  await ceiling.fill("2.6");
  await ceiling.press("Enter");
  await expect
    .poll(async () => (await savedProject(projectId)).scene.room.ceilingHeightM)
    .toBe(2.6);
  await roomPanel.getByLabel("floor colour").fill("#c8b89a");
  await expect
    .poll(async () => (await savedProject(projectId)).scene.room.surfaces)
    .toEqual({ floor: { color: "#c8b89a" } });
  await roomPanel.getByRole("button", { name: "Reset floor colour" }).click();
  await expect
    .poll(async () => (await savedProject(projectId)).scene.room.surfaces)
    .toEqual({});
  await ceiling.focus();
  await ceiling.press("Escape");
  await expect(ceiling).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(roomPanel).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("room-size")).toHaveText(
    "5.00 × 4.00 × 2.60 m",
  );
  const reloaded = await savedProject(projectId);
  const reloadedPort = findPort(reloaded.scene.items);
  expect(reloadedPort.placement).toEqual(placed.placement);
  expect(reloadedPort.sizeM.width).toBe(0.09);
  expect(
    reloaded.scene.room.walls.some(
      (wall) => wall.id === reloadedPort.placement.wallId,
    ),
  ).toBe(true);
  await expect.poll(() => shownCamera(page)).toEqual(reloaded.scene.camera);
  const reloadedCamera = reloaded.scene.camera;
  const front = portFront({
    room: reloaded.scene.room,
    port: reloadedPort,
    camera: reloadedCamera,
  });
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  await page.mouse.click(front.x, front.y);
  await expect(inspector).toContainText("Charging port");
  await expect(inspector.getByLabel("along")).toHaveValue("1.20");
  await expect(inspector.getByLabel("above floor")).toHaveValue("0.30");
  await expect(
    inspector.getByText(
      `Wall ${reloaded.scene.room.walls.findIndex((wall) => wall.id === reloadedPort.placement.wallId) + 1}`,
      { exact: true },
    ),
  ).toBeVisible();

  const snapshotDownload = page.waitForEvent("download");
  await page.keyboard.press("Meta+Shift+S");
  const snapshot = await snapshotDownload;
  expect(snapshot.suggestedFilename()).toMatch(/^[0-9TZ-]+\.png$/);
  await expect(page.getByTestId("editor-status")).toContainText(
    "snapshot saved",
  );
  const snapshotPath = testInfo.outputPath("snapshot.png");
  await snapshot.saveAs(snapshotPath);
  const snapshotPixels = await readPixels({
    page,
    png: readFileSync(snapshotPath),
    region: "all",
  });
  expect(snapshotPixels.width).toBe(viewport.width * 2);
  expect(snapshotPixels.height).toBe(viewport.height * 2);
  expect(snapshotPixels.lumaVariance).toBeGreaterThan(10);
  const e2eHome = process.env.PLANNER_E2E_HOME;
  if (e2eHome === undefined) throw new Error("PLANNER_E2E_HOME is not set");
  expect(
    readdirSync(join(e2eHome, "projects", projectId, "snapshots")),
  ).toContain(snapshot.suggestedFilename());

  await page
    .getByRole("dialog", { name: "Snapshot photo", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByTestId("project-title").click();
  const menu = page.getByRole("menu", { name: "Project" });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-menu.png") });
  await menu.getByRole("menuitem", { name: "rename" }).click();
  const nameField = menu.getByLabel("Project name");
  await nameField.fill("Gate panel");
  await nameField.press("Enter");
  await expect(page.getByTestId("project-title")).toContainText("Gate panel");
  await expect
    .poll(async () => (await savedProject(projectId)).name)
    .toBe("Gate panel");
  const beforeExport = await savedProject(projectId);
  const exportDownload = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "export .iplan" }).click();
  const exported = await exportDownload;
  expect(exported.suggestedFilename()).toBe("Gate panel.iplan");
  const archivePath = testInfo.outputPath("Gate panel.iplan");
  await exported.saveAs(archivePath);
  await page.getByTestId("project-title").click();
  await menu.getByLabel("Import .iplan file").setInputFiles(archivePath);
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/projects/") &&
      !url.pathname.endsWith(projectId),
  );
  const importedId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  expect(importedId).not.toBe(projectId);
  const imported = await savedProject(importedId);
  expect(imported.id).toBe(importedId);
  expect(imported.name).toBe("Gate panel");
  expect(imported.scene).toEqual(beforeExport.scene);

  const archiveBase64 = readFileSync(archivePath).toString("base64");
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "Gate panel.iplan"));
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true }),
    );
  }, archiveBase64);
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/projects/") &&
      !url.pathname.endsWith(importedId),
  );
  const droppedId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  expect([projectId, importedId]).not.toContain(droppedId);
  expect((await savedProject(droppedId)).scene).toEqual(beforeExport.scene);

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId("room-size")).toHaveText(
    "5.00 × 4.00 × 2.60 m",
  );
  const shown = (await savedProject(projectId)).scene.camera;
  await expect
    .poll(() => shownCamera(page), { timeout: 15_000 })
    .toEqual(shown);
  const again = portFront({
    room: reloaded.scene.room,
    port: reloadedPort,
    camera: shown,
  });
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  await page.mouse.click(again.x, again.y);
  await expect(inspector).toContainText("Charging port");
  await page.keyboard.press("Shift+2");
  await expect.poll(() => shownCamera(page)).not.toEqual(shown);
  await page.waitForTimeout(1200);
  await blurAndDeselect(page);
  const grey = await readPixels({
    page,
    png: await page.screenshot(),
    region: "centre",
  });
  expect(Math.abs(grey.red - grey.blue)).toBeLessThan(16);
  expect(Math.abs(grey.green - grey.blue)).toBeLessThan(16);

  const framed = await shownCamera(page);
  if (framed === undefined) throw new Error("no framed camera");
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  await expect(inspector).toContainText("Charging port");
  await inspector.getByRole("button", { name: "colorize" }).click();
  await inspector.getByLabel("Colorize colour").fill("#1e50e6");
  await expect
    .poll(
      async () =>
        findPort((await savedProject(projectId)).scene.items).colorAdjust,
    )
    .toEqual({ kind: "colorize", color: "#1e50e6", strength: 1 });
  await page.screenshot({ path: testInfo.outputPath("inspector-colour.png") });
  await blurAndDeselect(page);
  expect(await shownCamera(page)).toEqual(framed);
  const blue = await readPixels({
    page,
    png: await page.screenshot(),
    region: "centre",
  });
  expect(blue.blue).toBeGreaterThan(blue.red + 60);
  expect(blue.blue).toBeGreaterThan(blue.green + 20);

  await page.mouse.click(centre.x, centre.y);
  await expect(inspector).toContainText("Charging port");
  await inspector.getByRole("button", { name: "shift" }).click();
  await inspector.getByLabel("hue").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () =>
        findPort((await savedProject(projectId)).scene.items).colorAdjust,
    )
    .toEqual({ kind: "shift", hueShiftDeg: 1, saturation: 0, lightness: 0 });
  expect(errors).toEqual([]);
});
