import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";
import { getRingRadius } from "../../items/get-ring-radius.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 5, y: 4.5, z: 6.5 },
  targetM: { x: 0, y: 0.8, z: 0 },
};
const table = {
  id: "snap-table",
  name: "Snap table",
  model: { kind: "pending", jobId: "snap-job" },
  placement: { kind: "floor", xM: 0.5, zM: 0.5, elevationM: 0, rotationRad: 0 },
  sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
  locked: false,
} satisfies Item;

function screen(pointM: { x: number; y: number; z: number }) {
  return projectToScreen({ camera, pointM, viewport });
}

async function openRoom(page: Page) {
  await page.setViewportSize(viewport);
  const project = await createProject({
    name: "Snapping",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item: table },
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  return project.id;
}

async function savedPlacement(projectId: string) {
  const project = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
  const item = project.scene.items.find((item) => item.id === table.id);
  if (item?.placement.kind !== "floor") throw new Error("Missing snap table");
  return item.placement;
}

async function drag(options: {
  page: Page;
  from: { x: number; y: number };
  to: { x: number; y: number };
  alt: boolean;
}) {
  if (options.alt) await options.page.keyboard.down("Alt");
  await options.page.mouse.move(options.from.x, options.from.y);
  await options.page.mouse.down();
  await options.page.mouse.move(options.to.x, options.to.y, { steps: 16 });
  await options.page.mouse.up();
  if (options.alt) await options.page.keyboard.up("Alt");
}

function gridError(options: { value: number; step: number }) {
  return Math.abs(
    options.value / options.step - Math.round(options.value / options.step),
  );
}

for (const example of [
  { snapping: true, alt: false, grid: true },
  { snapping: false, alt: false, grid: false },
  { snapping: true, alt: true, grid: false },
  { snapping: false, alt: true, grid: true },
]) {
  test(`move with snap ${example.snapping ? "on" : "off"}, Alt ${example.alt ? "held" : "released"}`, async ({
    page,
  }) => {
    const projectId = await openRoom(page);
    await page.keyboard.press("g");
    await expect(
      page.getByRole("button", { name: "gridG", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    const toggle = page.getByRole("button", { name: "snapS", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    if (!example.snapping) await page.keyboard.press("s");
    await drag({
      page,
      from: screen({ x: 0.5, y: 0.5, z: 0.5 }),
      to: screen({ x: 0.873, y: 0.5, z: 0.719 }),
      alt: example.alt,
    });
    await expect
      .poll(async () => (await savedPlacement(projectId)).xM)
      .not.toBe(0.5);
    const placement = await savedPlacement(projectId);
    for (const value of [placement.xM, placement.zM]) {
      const error = gridError({ value, step: 0.05 });
      if (example.grid) expect(error).toBeLessThan(1e-9);
      else expect(error).toBeGreaterThan(0.05);
    }
    await expect(toggle).toHaveAttribute(
      "aria-pressed",
      String(example.snapping),
    );
  });

  test(`rotate with snap ${example.snapping ? "on" : "off"}, Alt ${example.alt ? "held" : "released"}`, async ({
    page,
  }) => {
    const projectId = await openRoom(page);
    await page.keyboard.press("g");
    await expect(
      page.getByRole("button", { name: "gridG", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    if (!example.snapping) await page.keyboard.press("s");
    await page.keyboard.press("r");
    const top = screen({ x: 0.5, y: 0.5, z: 0.5 });
    await page.mouse.click(top.x, top.y);
    await expect(
      page.getByRole("complementary", { name: "Inspector" }),
    ).toContainText("Snap table");
    const radiusM = getRingRadius({
      placementKind: "floor",
      sizeM: table.sizeM,
    });
    const turnRad = (20 * Math.PI) / 180;
    await drag({
      page,
      from: screen({ x: 0.5 + radiusM, y: 0, z: 0.5 }),
      to: screen({
        x: 0.5 + Math.cos(turnRad) * radiusM,
        y: 0,
        z: 0.5 - Math.sin(turnRad) * radiusM,
      }),
      alt: example.alt,
    });
    await expect
      .poll(async () => (await savedPlacement(projectId)).rotationRad)
      .not.toBe(0);
    const placement = await savedPlacement(projectId);
    if (example.grid)
      expect(placement.rotationRad).toBeCloseTo(Math.PI / 12, 9);
    else expect(placement.rotationRad).toBeCloseTo(turnRad, 1);
  });
}

test("snap button, S and palette share a saved browser setting", async ({
  page,
}, testInfo) => {
  await openRoom(page);
  const toggle = page.getByRole("button", { name: "snapS", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("snap-on.png") });
  await page.keyboard.press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /commands/ }).click();
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("snapping");
  await page.getByRole("combobox", { name: "Search commands" }).press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("textbox", { name: "Message" }).fill("s");
  await page.getByRole("textbox", { name: "Message" }).press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: testInfo.outputPath("snap-off.png") });
});

test("snap works and defaults on when browser storage is unavailable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage unavailable");
      },
    });
  });
  await openRoom(page);
  const toggle = page.getByRole("button", { name: "snapS", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
