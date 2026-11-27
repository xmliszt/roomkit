import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { getRingRadius } from "../src/items/get-ring-radius.ts";
import { mockGeneration } from "./mock-generation.ts";

const viewport = { width: 1440, height: 900 };
const evidence = resolve("docs/work-packages/evidence");

async function setup(options: { page: Page; opening?: boolean }) {
  const page = options.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockGeneration({
    page,
    count: 3,
    handleCommand(command) {
      if (
        command.type === "objects.library" ||
        command.type === "objects.archived"
      )
        return { ok: true, result: { objects: [] } };
      if (command.type === "item.sources")
        return { ok: true, result: { items: [] } };
      return undefined;
    },
  });
  for (const index of [0, 1, 2]) {
    fixture.ready(index);
  }
  if (options.opening) {
    fixture.apply({
      command: {
        type: "item.update",
        itemId: "item-2",
        patch: {
          cutsOpening: true,
          sizeM: { width: 1, height: 1, depth: 0.12 },
          placement: {
            kind: "wall",
            wallId: "wall-4",
            alongM: 3,
            heightM: 1.4,
            rotationRad: 0,
          },
        },
      },
    });
    fixture.apply({
      command: {
        type: "surface.update",
        surfaceId: "wall-4",
        color: "#32663a",
      },
    });
    fixture.camera.positionM = { x: 0, y: 3, z: 6 };
    fixture.camera.targetM = { x: 0, y: 1, z: -2.5 };
  }
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(fixture.camera),
  );
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  const points = [0, 1, 2].map((index) =>
    projectToScreen({
      camera: fixture.camera,
      viewport,
      pointM: {
        x: (index % 2) * 2 - 1,
        y: 0.7,
        z: Math.floor(index / 2) * 2 - 0.5,
      },
    }),
  );
  return { ...fixture, points };
}

function colorUpdates(commands: unknown[]) {
  return commands
    .map((command) => ClientCommandSchema.parse(command))
    .flatMap((command) =>
      command.type === "scene.apply" &&
      command.command.type === "item.update" &&
      command.command.patch.colorAdjust !== undefined
        ? [
            {
              itemId: command.command.itemId,
              colorAdjust: command.command.patch.colorAdjust,
            },
          ]
        : [],
    );
}

async function readItems(page: Page) {
  return z
    .array(ItemSchema)
    .parse(
      JSON.parse(
        (await page.getByTestId("scene").getAttribute("data-items")) ?? "[]",
      ),
    );
}

async function bluePixels(options: {
  page: Page;
  points: { x: number; y: number }[];
}) {
  const png = await options.page.locator("canvas").first().screenshot();
  return options.page.evaluate(
    async (input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(image, 0, 0);
      return input.points.map((point) => {
        const [r = 0, g = 0, b = 0] = context.getImageData(
          Math.round(point.x),
          Math.round(point.y),
          1,
          1,
        ).data;
        return b > r * 2 && b > g * 2 && b > 80;
      });
    },
    { base64: png.toString("base64"), points: options.points },
  );
}

async function selectThree(options: {
  page: Page;
  points: { x: number; y: number }[];
}) {
  for (const [index, point] of options.points.entries()) {
    if (index > 0) await options.page.keyboard.down("Shift");
    await options.page.mouse.click(point.x, point.y);
    if (index > 0) await options.page.keyboard.up("Shift");
  }
  await expect(
    options.page.getByRole("heading", { name: "3 selected" }),
  ).toBeVisible();
}

test("shift-select three, preview blue on every mesh, commit and undo once", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await selectThree({ page, points: fixture.points });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const original = await readItems(page);
  await inspector
    .getByRole("button", { name: "colorize", exact: true })
    .click();
  await inspector.getByLabel("Colorize colour").evaluate((input) => {
    if (!(input instanceof HTMLInputElement))
      throw new Error("Missing colour input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "#0000ff");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => bluePixels({ page, points: fixture.points }))
    .toEqual([true, true, true]);
  await inspector.getByLabel("Colorize colour").dispatchEvent("change");
  await expect
    .poll(async () => (await readItems(page)).map((item) => item.colorAdjust))
    .toEqual(
      Array.from({ length: 3 }, () => ({
        kind: "colorize",
        color: "#0000ff",
        strength: 1,
      })),
    );
  await expect
    .poll(() => colorUpdates(fixture.sentCommands))
    .toEqual(
      [0, 1, 2].map((index) => ({
        itemId: `item-${index}`,
        colorAdjust: { kind: "colorize", color: "#0000ff", strength: 1 },
      })),
    );
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "a23-three-blue.png") });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readItems(page)).toEqual(original);
  await expect
    .poll(() => colorUpdates(fixture.sentCommands).slice(3))
    .toEqual(
      [2, 1, 0].map((index) => ({
        itemId: `item-${index}`,
        colorAdjust: null,
      })),
    );
  await expect
    .poll(() => bluePixels({ page, points: fixture.points }))
    .toEqual([false, false, false]);
  await page.screenshot({ path: resolve(evidence, "a23-one-undo.png") });
});

test("selection toggles, primary dimensions, context actions and all references", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await selectThree({ page, points: fixture.points });
  await expect(page.getByTestId("item-dimension")).toHaveCount(3);
  const point = fixture.points.at(0);
  if (!point) throw new Error("Missing first item");
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Colour…",
    "Send to Chat",
    /^Duplicate all/,
    "Mirror all",
    "Lock all",
    "Delete all",
  ]);
  await menu.getByRole("menuitem", { name: "Send to Chat" }).click();
  for (const name of ["Chair 1", "Chair 2", "Chair 3"])
    await expect(
      page.getByRole("button", { name: `Remove reference to ${name}` }),
    ).toBeVisible();
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    "[]",
  );
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("heading", { name: "3 selected" })).toBeVisible();
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "2 selected" })).toBeVisible();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-1","item-2"]',
  );
});

test("group drag, nudge, duplicate, lock, mirror and delete each undo together", async ({
  page,
}) => {
  const fixture = await setup({ page });
  fixture.apply({
    command: { type: "item.update", itemId: "item-2", patch: { locked: true } },
  });
  await selectThree({ page, points: fixture.points });
  const original = await readItems(page);
  const point = fixture.points.at(0);
  if (!point) throw new Error("Missing first item");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const target = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: -0.5, y: 0.7, z: -0.25 },
  });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await readItems(page)).map((item) =>
        item.placement.kind === "floor"
          ? { xM: item.placement.xM, zM: item.placement.zM }
          : undefined,
      ),
    )
    .toEqual([
      { xM: -0.5, zM: -0.75 },
      { xM: 1.5, zM: -0.75 },
      { xM: -1, zM: 1 },
    ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readItems(page)).toEqual(original);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () =>
      (await readItems(page)).map((item) =>
        item.placement.kind === "floor"
          ? { xM: item.placement.xM, zM: item.placement.zM }
          : undefined,
      ),
    )
    .toEqual([
      { xM: -0.95, zM: -1 },
      { xM: 1.05, zM: -1 },
      { xM: -1, zM: 1 },
    ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readItems(page)).toEqual(original);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  for (const action of [
    "Lock all",
    "Mirror all",
    "Duplicate all",
    "Delete all",
  ]) {
    await inspector.getByRole("button", { name: action, exact: true }).click();
    if (action === "Lock all")
      await expect
        .poll(async () => (await readItems(page)).every((item) => item.locked))
        .toBe(true);
    if (action === "Mirror all")
      await expect
        .poll(async () =>
          (await readItems(page)).every((item) => item.mirrored),
        )
        .toBe(true);
    if (action === "Duplicate all")
      await expect.poll(async () => (await readItems(page)).length).toBe(6);
    if (action === "Delete all")
      await expect.poll(async () => (await readItems(page)).length).toBe(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readItems(page)).toEqual(original);
    await page.locator("canvas").first().focus();
    await page.keyboard.press("ControlOrMeta+a");
  }
});

test("Objects panel toggles the set and mixed colour fields stay empty until edited", async ({
  page,
}) => {
  const fixture = await setup({ page });
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: {
        colorAdjust: { kind: "colorize", color: "#ff0000", strength: 0.4 },
        locked: true,
      },
    },
  });
  await page.locator("canvas").first().focus();
  await page.keyboard.press("o");
  await page
    .getByRole("region", { name: "Project objects" })
    .locator("button[aria-expanded]")
    .filter({ hasText: "Chair 1" })
    .first()
    .click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-0"]',
  );
  await page.keyboard.down("Shift");
  await page
    .getByRole("region", { name: "Project objects" })
    .locator("button[aria-expanded]")
    .filter({ hasText: "Chair 2" })
    .first()
    .click();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-0","item-1"]',
  );
  await page
    .getByRole("region", { name: "Project objects" })
    .locator("button[aria-expanded]")
    .filter({ hasText: "Chair 1" })
    .first()
    .click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-0","item-1"]',
  );
  await page
    .getByRole("region", { name: "Project objects" })
    .locator("button[aria-expanded]")
    .filter({ hasText: "Chair 3" })
    .first()
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-0","item-1","item-2"]',
  );
  await page.locator("canvas").first().focus();
  await page.keyboard.press("c");
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Colour · mixed");
  await expect(
    inspector.getByRole("button", { name: "original", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(inspector.getByLabel("Colorize colour")).toHaveCount(0);
  await expect(inspector.getByRole("textbox")).toHaveCount(0);
  await inspector
    .getByRole("button", { name: "original", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await readItems(page)).every((item) => item.colorAdjust === undefined),
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(inspector).toContainText("Colour · mixed");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await readItems(page)).at(1)?.placement)
    .not.toEqual({
      kind: "floor",
      xM: 1,
      zM: -1,
      elevationM: 0,
      rotationRad: 0,
    });
  expect((await readItems(page)).at(0)?.colorAdjust).toEqual({
    kind: "colorize",
    color: "#ff0000",
    strength: 0.4,
  });
  expect((await readItems(page)).at(0)?.placement).toEqual({
    kind: "floor",
    xM: -1,
    zM: -1,
    elevationM: 0,
    rotationRad: 0,
  });
  expect([
    ...new Set(
      fixture.sentCommands
        .map((command) => ClientCommandSchema.parse(command))
        .filter((command) => command.type === "item.sources")
        .map((command) => command.itemId),
    ),
  ]).toEqual(["item-0"]);
});

test("a locked primary anchors group rotation without moving itself", async ({
  page,
}) => {
  const fixture = await setup({ page });
  fixture.apply({
    command: { type: "item.update", itemId: "item-2", patch: { locked: true } },
  });
  await selectThree({ page, points: fixture.points });
  const original = await readItems(page);
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  const radiusM = getRingRadius({
    placementKind: "floor",
    sizeM: { width: 1, height: 1, depth: 1 },
  });
  const point = (angleRad: number) =>
    projectToScreen({
      camera: fixture.camera,
      viewport,
      pointM: {
        x: -1 + Math.cos(angleRad) * radiusM,
        y: 0,
        z: 1 - Math.sin(angleRad) * radiusM,
      },
    });
  const start = point(0);
  const end = point(Math.PI / 9);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await readItems(page)).map((item) =>
        Math.round((item.placement.rotationRad * 180) / Math.PI),
      ),
    )
    .toEqual([15, 15, 0]);
  expect((await readItems(page)).at(2)?.placement).toEqual(
    original.at(2)?.placement,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readItems(page)).toEqual(original);
});

test("Colour from the group menu reveals hidden chrome", async ({ page }) => {
  const fixture = await setup({ page });
  await selectThree({ page, points: fixture.points });
  await page.keyboard.press("\\");
  const point = fixture.points.at(0);
  if (!point) throw new Error("Missing first point");
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Colour…", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3 selected" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Colour mode" })).toBeVisible();
});

test("plain drag replaces a group and moves only the unselected item", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const first = fixture.points.at(0);
  const second = fixture.points.at(1);
  const third = fixture.points.at(2);
  if (!first || !second || !third) throw new Error("Missing item point");
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "2 selected" })).toBeVisible();
  const target = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: -0.5, y: 0.7, z: 1.75 },
  });
  await page.mouse.move(third.x, third.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-2"]',
  );
  await expect
    .poll(async () =>
      (await readItems(page)).map((item) =>
        item.placement.kind === "floor"
          ? { xM: item.placement.xM, zM: item.placement.zM }
          : undefined,
      ),
    )
    .toEqual([
      { xM: -1, zM: -1 },
      { xM: 1, zM: -1 },
      { xM: -0.5, zM: 1.25 },
    ]);
});

test("removed ids stay unselected after redo and a remote re-add", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await selectThree({ page, points: fixture.points });
  const original = await readItems(page);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => (await readItems(page)).length).toBe(6);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await readItems(page)).length).toBe(3);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    "[]",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await readItems(page)).length).toBe(6);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    "[]",
  );
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ControlOrMeta+a");
  fixture.apply({ command: { type: "item.remove", itemId: "item-0" } });
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.getByTestId("scene").getAttribute("data-selected-items")) ??
          "[]",
      ),
    )
    .not.toContain("item-0");
  const removed = original.at(0);
  if (!removed) throw new Error("Missing removed item");
  fixture.apply({ command: { type: "item.add", item: removed } });
  await expect.poll(async () => (await readItems(page)).length).toBe(6);
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.getByTestId("scene").getAttribute("data-selected-items")) ??
          "[]",
      ),
    )
    .not.toContain("item-0");
});

test("Shift+2 frames every selected item", async ({ page }) => {
  const fixture = await setup({ page });
  await selectThree({ page, points: fixture.points });
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Shift+Digit2");
  await expect
    .poll(async () => {
      const camera = CameraSchema.parse(
        JSON.parse(
          (await page.getByTestId("scene").getAttribute("data-camera")) ?? "{}",
        ),
      );
      return (
        camera.targetM.z < 0.9 &&
        camera.targetM.x > -0.9 &&
        [-1, 1]
          .flatMap((xM) =>
            [-1, 1].flatMap((zM) =>
              [-0.5, 0.5].flatMap((dxM) =>
                [-0.5, 0.5].map((dzM) =>
                  projectToScreen({
                    camera,
                    viewport,
                    pointM: { x: xM + dxM, y: 0.5, z: zM + dzM },
                  }),
                ),
              ),
            ),
          )
          .every(
            (point) =>
              point.x > 40 &&
              point.x < viewport.width - 40 &&
              point.y > 40 &&
              point.y < viewport.height - 40,
          )
      );
    })
    .toBe(true);
});

test("mode plus blue is one undo step for a single uncoloured item", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const point = fixture.points.at(0);
  if (!point) throw new Error("Missing first point");
  await page.mouse.click(point.x, point.y);
  const original = await readItems(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector
    .getByRole("button", { name: "colorize", exact: true })
    .click();
  await inspector.getByLabel("Colorize colour").fill("#0000ff");
  await expect
    .poll(async () => (await readItems(page)).at(0)?.colorAdjust)
    .toEqual({ kind: "colorize", color: "#0000ff", strength: 1 });
  await expect
    .poll(() => colorUpdates(fixture.sentCommands))
    .toEqual([
      {
        itemId: "item-0",
        colorAdjust: { kind: "colorize", color: "#0000ff", strength: 1 },
      },
    ]);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readItems(page)).toEqual(original);
  await expect
    .poll(() => colorUpdates(fixture.sentCommands).at(1))
    .toEqual({ itemId: "item-0", colorAdjust: null });
});

async function greenPixels(options: {
  page: Page;
  points: { x: number; y: number }[];
}) {
  const png = await options.page.locator("canvas").first().screenshot();
  return options.page.evaluate(
    async (input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(image, 0, 0);
      return input.points.map((point) => {
        const [r = 0, g = 0, b = 0] = context.getImageData(
          Math.round(point.x),
          Math.round(point.y),
          1,
          1,
        ).data;
        return g > r * 1.3 && g > b * 1.2;
      });
    },
    { base64: png.toString("base64"), points: options.points },
  );
}

test("dragging an unselected opening moves its wall cut before release", async ({
  page,
}) => {
  const fixture = await setup({ page, opening: true });
  const first = fixture.points.at(0);
  const second = fixture.points.at(1);
  if (!first || !second) throw new Error("Missing floor points");
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "2 selected" })).toBeVisible();
  const points = [0, 1.2].map((x) =>
    projectToScreen({
      camera: fixture.camera,
      viewport,
      pointM: { x, y: 1.1, z: -2.5 },
    }),
  );
  await expect.poll(() => greenPixels({ page, points })).toEqual([false, true]);
  const start = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: 0, y: 1.8, z: -2.38 },
  });
  const end = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: 1.2, y: 1.8, z: -2.38 },
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(() => greenPixels({ page, points })).toEqual([true, false]);
  expect((await readItems(page)).at(2)?.placement).toMatchObject({ alongM: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readItems(page)).at(2)?.placement)
    .toMatchObject({ alongM: 1.8 });
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-selected-items",
    '["item-2"]',
  );
  await page.screenshot({
    path: resolve(evidence, "a23-unselected-opening.png"),
  });
});

test("keyboard panel transitions commit a pending mode before the inspector unmounts", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const point = fixture.points.at(0);
  if (!point) throw new Error("Missing first point");
  await page.mouse.click(point.x, point.y);
  await page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("button", { name: "colorize", exact: true })
    .click();
  expect(colorUpdates(fixture.sentCommands)).toEqual([]);
  await page.keyboard.press("c");
  await expect
    .poll(() => colorUpdates(fixture.sentCommands))
    .toEqual([
      {
        itemId: "item-0",
        colorAdjust: { kind: "colorize", color: "#808080", strength: 1 },
      },
    ]);
  await page.reload();
  await expect
    .poll(async () => (await readItems(page)).at(0)?.colorAdjust)
    .toEqual({ kind: "colorize", color: "#808080", strength: 1 });
});
