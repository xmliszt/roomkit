import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { getRingRadius } from "../apps/web/src/items/get-ring-radius.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

type Vec3 = { x: number; y: number; z: number };

const viewport = { width: 1440, height: 900 };
const roomSizeM = 4;
const camera = {
  positionM: { x: 5, y: 4.5, z: 6.5 },
  targetM: { x: 0, y: 0.8, z: 0 },
};
const wallFrames: {
  [wallId: string]: { startM: Vec3; direction: Vec3; inward: Vec3 };
} = {
  "wall-1": {
    startM: { x: -2, y: 0, z: -2 },
    direction: { x: 0, y: 0, z: 1 },
    inward: { x: 1, y: 0, z: 0 },
  },
  "wall-4": {
    startM: { x: 2, y: 0, z: -2 },
    direction: { x: -1, y: 0, z: 0 },
    inward: { x: 0, y: 0, z: 1 },
  },
};
const floorItem = {
  id: "side-table",
  name: "Side table",
  model: { kind: "pending", jobId: "job-side-table" },
  placement: { kind: "floor", xM: 0.5, zM: 0.5, elevationM: 0, rotationRad: 0 },
  sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
  locked: false,
} satisfies Item;

function screen(pointM: Vec3) {
  return projectToScreen({ camera, pointM, viewport });
}

async function savedProject(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
}

async function shownItems(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-items");
  return value === null
    ? undefined
    : z.array(ItemSchema).parse(JSON.parse(value));
}

async function expectSceneSaved(options: {
  page: Page;
  projectId: string;
  itemCount: number;
  step: string;
}) {
  await expect
    .poll(
      async () => {
        const saved = (await savedProject(options.projectId)).scene.items;
        const shown = await shownItems(options.page);
        return (
          saved.length === options.itemCount &&
          JSON.stringify(saved) === JSON.stringify(shown)
        );
      },
      { message: `${options.step}: page and daemon hold the same items` },
    )
    .toBe(true);
  return (await savedProject(options.projectId)).scene.items;
}

function wallPoint(options: {
  wallId: string;
  alongM: number;
  heightM: number;
  outM: number;
}) {
  const frame = wallFrames[options.wallId];
  if (frame === undefined) throw new Error(`no frame for ${options.wallId}`);
  return {
    x:
      frame.startM.x +
      frame.direction.x * options.alongM +
      frame.inward.x * options.outM,
    y: options.heightM,
    z:
      frame.startM.z +
      frame.direction.z * options.alongM +
      frame.inward.z * options.outM,
  };
}

async function drag(options: {
  page: Page;
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  await options.page.mouse.move(options.from.x, options.from.y);
  await options.page.mouse.down();
  await options.page.mouse.move(options.to.x, options.to.y, { steps: 16 });
  await options.page.mouse.up();
}

function findPort(items: Item[]) {
  const port = items.find((item) => item.name === "Charging port");
  if (port === undefined || port.placement.kind !== "wall") {
    throw new Error("no charging port on a wall");
  }
  return { ...port, placement: port.placement };
}

test("add, move, rotate, duplicate, delete, undo and redo items", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  const created = await createProject({
    name: "Items",
    widthM: roomSizeM,
    depthM: roomSizeM,
    ceilingHeightM: 2.6,
  });
  const projectId = created.id;
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: { type: "camera.set", camera },
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId,
    command: { type: "item.add", item: floorItem },
  });
  await page.goto(`/projects/${projectId}`);
  await expect
    .poll(async () => {
      const value = await page.getByTestId("scene").getAttribute("data-camera");
      return value === null ? undefined : CameraSchema.parse(JSON.parse(value));
    })
    .toEqual(camera);
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toHaveText("Side table · queued");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("option", { name: /Charging port/ })
    .first()
    .click();
  const added = findPort(
    await expectSceneSaved({ page, projectId, itemCount: 2, step: "add" }),
  );
  expect(Object.keys(wallFrames)).toContain(added.placement.wallId);
  expect(added.placement.heightM).toBe(0.3);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Charging port");
  await expect(inspector.getByLabel("along")).toHaveValue(
    added.placement.alongM.toFixed(2),
  );
  await expect(page.getByTestId("item-dimension")).toHaveText([
    "0.09 m",
    "0.09 m",
    "0.01 m",
  ]);
  await page.waitForTimeout(300);

  const portFront = (placement: typeof added.placement) =>
    screen(
      wallPoint({
        wallId: placement.wallId,
        alongM: placement.alongM,
        heightM: placement.heightM,
        outM: 0.005,
      }),
    );
  await expect(
    page
      .getByRole("toolbar", { name: "Tools" })
      .getByRole("button", { name: "Select", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const shiftM = added.placement.alongM + 0.4 <= roomSizeM - 0.3 ? 0.4 : -0.4;
  await drag({
    page,
    from: portFront(added.placement),
    to: screen(
      wallPoint({
        wallId: added.placement.wallId,
        alongM: added.placement.alongM + shiftM,
        heightM: added.placement.heightM,
        outM: 0.005,
      }),
    ),
  });
  await expect
    .poll(
      async () =>
        findPort((await savedProject(projectId)).scene.items).placement.alongM,
    )
    .not.toBe(added.placement.alongM);
  const moved = findPort(
    await expectSceneSaved({ page, projectId, itemCount: 2, step: "move" }),
  );
  const changeM = moved.placement.alongM - added.placement.alongM;
  expect(Math.abs(changeM), "moved about 0.4 m").toBeGreaterThan(0.25);
  expect(
    Math.abs(changeM * 20 - Math.round(changeM * 20)),
    `alongM changed by ${changeM}, a multiple of 0.05 m`,
  ).toBeLessThan(1e-9);
  expect(moved.placement.wallId).toBe(added.placement.wallId);
  await page.waitForTimeout(400);

  const otherWallId = moved.placement.wallId === "wall-1" ? "wall-4" : "wall-1";
  await drag({
    page,
    from: portFront(moved.placement),
    to: screen(
      wallPoint({ wallId: otherWallId, alongM: 2, heightM: 1, outM: 0 }),
    ),
  });
  await expect
    .poll(
      async () =>
        findPort((await savedProject(projectId)).scene.items).placement.wallId,
    )
    .toBe(otherWallId);
  const rewalled = findPort(
    await expectSceneSaved({
      page,
      projectId,
      itemCount: 2,
      step: "other wall",
    }),
  );
  expect(rewalled.placement.alongM).toBeCloseTo(2, 1);
  expect(rewalled.placement.heightM).toBeCloseTo(1, 1);

  await page.keyboard.press("r");
  const table = screen({ x: 0.5, y: 0.5, z: 0.5 });
  await page.mouse.click(table.x, table.y);
  await expect(inspector).toContainText("Side table");
  const ringRadiusM = getRingRadius({
    placementKind: "floor",
    sizeM: floorItem.sizeM,
  });
  const turnRad = (20 * Math.PI) / 180;
  await drag({
    page,
    from: screen({ x: 0.5 + ringRadiusM, y: 0, z: 0.5 }),
    to: screen({
      x: 0.5 + Math.cos(turnRad) * ringRadiusM,
      y: 0,
      z: 0.5 - Math.sin(turnRad) * ringRadiusM,
    }),
  });
  const turned = (
    await expectSceneSaved({ page, projectId, itemCount: 2, step: "rotate" })
  ).find((item) => item.id === floorItem.id);
  expect(turned?.placement.rotationRad).toBeCloseTo(Math.PI / 12, 9);

  await page.keyboard.press("v");
  await page.mouse.click(
    portFront(rewalled.placement).x,
    portFront(rewalled.placement).y,
  );
  await expect(inspector).toContainText("Charging port");
  await page.keyboard.press("ControlOrMeta+d");
  const duplicated = await expectSceneSaved({
    page,
    projectId,
    itemCount: 3,
    step: "duplicate",
  });
  await expect(inspector).toContainText("Charging port");
  await page.keyboard.press("Backspace");
  await expectSceneSaved({ page, projectId, itemCount: 2, step: "delete" });
  await expect(inspector).toBeHidden();
  await page.keyboard.press("ControlOrMeta+z");
  const restored = await expectSceneSaved({
    page,
    projectId,
    itemCount: 3,
    step: "undo delete",
  });
  expect(restored).toEqual(duplicated);
  await page.keyboard.press("ControlOrMeta+z");
  await expectSceneSaved({
    page,
    projectId,
    itemCount: 2,
    step: "undo duplicate",
  });
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone = await expectSceneSaved({
    page,
    projectId,
    itemCount: 3,
    step: "redo duplicate",
  });
  expect(redone).toEqual(duplicated);

  await page.mouse.click(
    portFront(rewalled.placement).x,
    portFront(rewalled.placement).y,
  );
  await expect(inspector).toContainText("Charging port");
  const portM = wallPoint({
    wallId: rewalled.placement.wallId,
    alongM: rewalled.placement.alongM,
    heightM: rewalled.placement.heightM,
    outM: 0.005,
  });
  await page.keyboard.press("Shift+2");
  await expect
    .poll(
      async () => {
        const value = await page
          .getByTestId("scene")
          .getAttribute("data-camera");
        if (value === null) return Number.POSITIVE_INFINITY;
        const { targetM } = CameraSchema.parse(JSON.parse(value));
        return Math.sqrt(
          (targetM.x - portM.x) ** 2 +
            (targetM.y - portM.y) ** 2 +
            (targetM.z - portM.z) ** 2,
        );
      },
      { message: "Shift+2 frames the selected port", timeout: 10_000 },
    )
    .toBeLessThan(0.05);

  await page.reload();
  await expectSceneSaved({ page, projectId, itemCount: 3, step: "reload" });
  expect(
    await shownItems(page),
    "the reloaded page shows the saved scene",
  ).toEqual(redone);
  await page.keyboard.press("Escape");
  expect(errors, "console errors").toEqual([]);
});
