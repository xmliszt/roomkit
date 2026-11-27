import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type Camera,
  CameraSchema,
} from "@planner/shared/src/scene/camera-schema.ts";
import {
  type Item,
  ItemSchema,
} from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const viewport = { width: 1440, height: 900 };
const item = {
  id: "navigation-table",
  name: "Navigation table",
  model: { kind: "pending", jobId: "navigation-job" },
  placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
  sizeM: { width: 0.5, height: 0.5, depth: 0.5 },
  locked: false,
} satisfies Item;

async function readCamera(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-camera");
  return CameraSchema.parse(JSON.parse(value ?? "null"));
}
async function readItems(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-items");
  return z.array(ItemSchema).parse(JSON.parse(value ?? "[]"));
}
function distance(camera: Camera) {
  return Math.hypot(
    camera.positionM.x - camera.targetM.x,
    camera.positionM.y - camera.targetM.y,
    camera.positionM.z - camera.targetM.z,
  );
}
async function openRoom(options: { page: Page; camera?: Camera }) {
  const { page } = options;
  const project = await createProject({
    name: "Viewport navigation",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.add", item },
  });
  if (options.camera)
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "camera.set", camera: options.camera },
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
  await expect(page.getByTestId("item-tag")).toBeAttached();
  return readCamera(page);
}
async function drag(options: {
  page: Page;
  button: "left" | "right" | "middle";
  from?: { x: number; y: number };
}) {
  const from = options.from ?? { x: 750, y: 680 };
  await options.page.mouse.move(from.x, from.y);
  await options.page.mouse.down({ button: options.button });
  await options.page.mouse.move(from.x + 90, from.y + 40, { steps: 10 });
  await options.page.mouse.up({ button: options.button });
}
async function selectItem(page: Page) {
  const camera = await readCamera(page);
  const point = projectToScreen({
    camera,
    pointM: { x: 0, y: 0.25, z: 0 },
    viewport,
  });
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("heading", { name: "Navigation table", exact: true }),
  ).toBeVisible();
  return point;
}

test("pan gestures preserve objects and selection; left drag orbits", async ({
  page,
}) => {
  await openRoom({ page });
  const point = await selectItem(page);
  const before = await readCamera(page);
  await page.keyboard.down("Space");
  await expect(page.locator("canvas").first()).toHaveCSS("cursor", "grab");
  await drag({ page, button: "left", from: point });
  await page.keyboard.up("Space");
  await expect
    .poll(async () => (await readCamera(page)).targetM)
    .not.toEqual(before.targetM);
  await expect(
    page.getByRole("heading", { name: "Navigation table", exact: true }),
  ).toBeVisible();
  expect(await readItems(page)).toEqual([item]);
  for (const button of ["right", "middle"] satisfies ("right" | "middle")[]) {
    const camera = await readCamera(page);
    await drag({ page, button });
    await expect
      .poll(async () => (await readCamera(page)).targetM)
      .not.toEqual(camera.targetM);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  const camera = await readCamera(page);
  await drag({ page, button: "left" });
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .not.toEqual(camera.positionM);
  const after = await readCamera(page);
  expect(after.targetM).toEqual(camera.targetM);
  expect(distance(after)).toBeCloseTo(distance(camera), 2);
  expect(await readItems(page)).toEqual([item]);
});

test("zoom, reset, room frame and selection frame", async ({ page }) => {
  const initial = await openRoom({ page });
  await page.evaluate(() => {
    window.addEventListener("keydown", (event) => {
      if (event.metaKey && ["=", "-", "0"].includes(event.key))
        document.documentElement.setAttribute(
          `data-zoom-${event.key === "=" ? "in" : event.key === "-" ? "out" : "reset"}`,
          String(event.defaultPrevented),
        );
    });
  });
  await page.keyboard.press("Meta+=");
  await expect
    .poll(async () => distance(await readCamera(page)))
    .toBeLessThan(distance(initial) - 0.1);
  const zoomed = await readCamera(page);
  await page.keyboard.press("Meta+-");
  await expect
    .poll(async () => distance(await readCamera(page)))
    .toBeGreaterThan(distance(zoomed) + 0.1);
  await expect(page.locator("html")).toHaveAttribute("data-zoom-in", "true");
  await expect(page.locator("html")).toHaveAttribute("data-zoom-out", "true");
  await page.keyboard.press("Shift+0");
  await expect.poll(() => readCamera(page)).toEqual(initial);
  await selectItem(page);
  await page.keyboard.press("Shift+2");
  await expect
    .poll(async () => (await readCamera(page)).targetM)
    .toEqual({ x: 0, y: 0.25, z: 0 });
  expect(distance(await readCamera(page))).toBeLessThan(distance(initial));
  await page.keyboard.press("f");
  await expect.poll(() => readCamera(page)).toEqual(initial);
  await page.keyboard.press("Meta+=");
  await expect
    .poll(async () => distance(await readCamera(page)))
    .toBeLessThan(distance(initial) - 0.1);
  await page.keyboard.press("Meta+0");
  await expect.poll(() => readCamera(page)).toEqual(initial);
  await expect(page.locator("html")).toHaveAttribute("data-zoom-reset", "true");
});

test("right-hold fly consumes the press and stops on release", async ({
  page,
}) => {
  const before = await openRoom({ page });
  const point = await selectItem(page);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => {
    window.addEventListener("keydown", (event) => {
      if (event.key === "w")
        document.documentElement.dataset.flyKeyObserved = String(
          event.defaultPrevented,
        );
    });
    document.querySelector("canvas")?.addEventListener("pointerup", (event) => {
      document.documentElement.dataset.rightPressConsumed = String(
        event.defaultPrevented,
      );
    });
  });
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.waitForTimeout(350);
  await page.mouse.up({ button: "right" });
  await page.keyboard.up("w");
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .not.toEqual(before.positionM);
  await expect(page.locator("html")).toHaveAttribute(
    "data-right-press-consumed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fly-key-observed",
    "true",
  );
  const after = await readCamera(page);
  expect(after.positionM.z).toBeLessThan(before.positionM.z);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("canvas").first()).toHaveAttribute(
    "data-viewport-navigation",
    "true",
  );
  await page.waitForTimeout(500);
  expect(await readCamera(page)).toEqual(after);
  const snap = page.getByRole("button", { name: "snapS", exact: true });
  await page.keyboard.press("s");
  await expect(snap).toHaveAttribute("aria-pressed", "false");
});

test("arrows pan, orbit, nudge with one undo per burst and ignore typing", async ({
  page,
}) => {
  const initial = await openRoom({ page });
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await readCamera(page)).targetM)
    .not.toEqual(initial.targetM);
  const panned = await readCamera(page);
  await page.keyboard.press("Alt+ArrowRight");
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .not.toEqual(panned.positionM);
  expect((await readCamera(page)).targetM).toEqual(panned.targetM);
  await page.keyboard.press("Meta+0");
  await expect.poll(() => readCamera(page)).toEqual(initial);
  await selectItem(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await readItems(page)).at(0)?.placement)
    .not.toEqual(item.placement);
  const nudged = (await readItems(page)).at(0)?.placement;
  if (nudged?.kind !== "floor") throw new Error("floor placement required");
  expect(Math.hypot(nudged.xM, nudged.zM)).toBeCloseTo(0.05);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readItems(page)).toEqual([item]);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(550);
  await page.keyboard.up("ArrowRight");
  await expect
    .poll(async () => (await readItems(page)).at(0)?.placement)
    .not.toEqual(item.placement);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readItems(page)).toEqual([item]);
  const beforeTyping = await readCamera(page);
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.keyboard.type("wasd qe ?");
  for (const key of [
    "ArrowRight",
    "Shift+0",
    "Shift+1",
    "Shift+2",
    "Meta+=",
    "Meta+-",
  ])
    await page.keyboard.press(key);
  expect(await readCamera(page)).toEqual(beforeTyping);
  expect(await readItems(page)).toEqual([item]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shortcut sheet closes with Escape and question mark and restores focus", async ({
  page,
}) => {
  await openRoom({ page });
  const button = page.getByRole("button", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await button.focus();
  await page.keyboard.press("Space");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Hold right mouse + W A S D")).toBeVisible();
  const evidenceDir =
    process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a18-evidence";
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "shortcuts.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press("?");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("?");
  await expect(sheet).toHaveCount(0);
});

test("right clicks below 4 px stay clicks and blur releases held keys", async ({
  page,
}) => {
  const initial = await openRoom({ page });
  await page.mouse.move(750, 650);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(752, 651);
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(500);
  expect(await readCamera(page)).toEqual(initial);
  await expect(page.locator("canvas").first()).not.toHaveAttribute(
    "data-viewport-navigation",
    "true",
  );
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("w");
  await page.mouse.up({ button: "right" });
  await expect
    .poll(async () => (await readCamera(page)).positionM)
    .not.toEqual(initial.positionM);
  const stopped = await readCamera(page);
  await page.waitForTimeout(500);
  expect(await readCamera(page)).toEqual(stopped);
});

test("fly keys follow the view, Shift is faster, and downward flight stops at the floor", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openRoom({
    page,
    camera: {
      positionM: { x: 0, y: 1, z: 4 },
      targetM: { x: 0, y: 0.5, z: 0 },
    },
  });
  async function fly(options: { key: string; shift?: boolean }) {
    const before = await readCamera(page);
    await page.mouse.move(750, 650);
    await page.mouse.down({ button: "right" });
    if (options.shift) await page.keyboard.down("Shift");
    await page.keyboard.down(options.key);
    await page.waitForTimeout(500);
    await page.keyboard.up(options.key);
    if (options.shift) await page.keyboard.up("Shift");
    await page.mouse.up({ button: "right" });
    await expect
      .poll(async () => (await readCamera(page)).positionM)
      .not.toEqual(before.positionM);
    const after = await readCamera(page);
    return {
      x: after.positionM.x - before.positionM.x,
      y: after.positionM.y - before.positionM.y,
      z: after.positionM.z - before.positionM.z,
    };
  }
  expect((await fly({ key: "a" })).x).toBeLessThan(-0.1);
  const normal = await fly({ key: "d" });
  expect(normal.x).toBeGreaterThan(0.1);
  const fast = await fly({ key: "d", shift: true });
  expect(fast.x).toBeGreaterThan(normal.x * 1.5);
  expect((await fly({ key: "s" })).z).toBeGreaterThan(0.1);
  expect((await fly({ key: "e" })).y).toBeGreaterThan(0.1);
  expect((await fly({ key: "q" })).y).toBeLessThan(-0.1);
  await fly({ key: "q", shift: true });
  expect((await readCamera(page)).positionM.y).toBeGreaterThan(0);
  expect((await readCamera(page)).targetM.y).toBeGreaterThan(0);
});

test("overhead arrows still move the selected object", async ({ page }) => {
  await openRoom({
    page,
    camera: { positionM: { x: 0, y: 8, z: 0 }, targetM: { x: 0, y: 0, z: 0 } },
  });
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await expect(
    page.getByRole("heading", { name: "Navigation table", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await readItems(page)).at(0)?.placement)
    .not.toEqual(item.placement);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readItems(page)).toEqual([item]);
});

test("ArrowUp pans the view up and ArrowDown keeps the camera above the near plane", async ({
  page,
}) => {
  await openRoom({ page });
  const startY = (await readCamera(page)).positionM.y;
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await readCamera(page)).positionM.y)
    .toBeGreaterThan(startY);
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowDown");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(500);
  expect((await readCamera(page)).positionM.y).toBeGreaterThanOrEqual(0.15);
});

test("consecutive nudges read the committed placement and Escape cancels a burst", async ({
  page,
}) => {
  await openRoom({ page });
  await selectItem(page);
  await page.evaluate(() => {
    for (let index = 0; index < 3; index++) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await expect
    .poll(async () => {
      const placement = (await readItems(page)).at(0)?.placement;
      return placement?.kind === "floor"
        ? Math.hypot(placement.xM, placement.zM)
        : 0;
    })
    .toBeCloseTo(0.15);
  const committed = await readItems(page);
  await page.keyboard.down("ArrowUp");
  await expect.poll(() => readItems(page)).not.toEqual(committed);
  await page.keyboard.press("Escape");
  await page.keyboard.up("ArrowUp");
  await expect.poll(() => readItems(page)).toEqual(committed);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const placement = (await readItems(page)).at(0)?.placement;
      return placement?.kind === "floor"
        ? Math.hypot(placement.xM, placement.zM)
        : 0;
    })
    .toBeCloseTo(0.1);
});

test("Meta finishes arrows and Space even when their keyups are lost", async ({
  page,
}) => {
  await openRoom({ page });
  await selectItem(page);
  for (const eventType of ["keydown", "keyup"]) {
    await page.evaluate((type) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Meta",
          metaKey: type === "keydown",
          bubbles: true,
          cancelable: true,
        }),
      );
    }, eventType);
    await expect(page.locator("canvas").first()).not.toHaveCSS(
      "cursor",
      "grab",
    );
    const settled = await readItems(page);
    await page.waitForTimeout(500);
    expect(await readItems(page)).toEqual(settled);
  }
});

for (const eventType of ["pointermove", "pointerup"]) {
  test(`fly ends when ${eventType} reports no right button`, async ({
    page,
  }) => {
    const initial = await openRoom({ page });
    await page.mouse.move(750, 650);
    await page.mouse.down({ button: "right" });
    await page.keyboard.down("w");
    await page.waitForTimeout(150);
    await page.evaluate((type) => {
      window.dispatchEvent(
        new PointerEvent(type, { button: 0, buttons: 0, bubbles: true }),
      );
    }, eventType);
    await expect.poll(() => readCamera(page)).not.toEqual(initial);
    const stopped = await readCamera(page);
    await page.waitForTimeout(500);
    expect(await readCamera(page)).toEqual(stopped);
    await page.keyboard.up("w");
    await page.mouse.up({ button: "right" });
  });
}

test("dialog, menu, list, tab and popover focus excludes navigation but prevents page zoom", async ({
  page,
}) => {
  const original = await openRoom({ page });
  await page.keyboard.press("Meta+=");
  await expect
    .poll(async () => distance(await readCamera(page)))
    .toBeLessThan(distance(original) - 0.1);
  const initial = await readCamera(page);
  for (const role of ["dialog", "menu", "listbox", "tablist", "popover"]) {
    await page.evaluate((kind) => {
      const container = document.createElement("div");
      container.id = "navigation-focus-fixture";
      if (kind === "popover") container.dataset.editorPopover = "";
      else container.role = kind;
      container.tabIndex = 0;
      document.querySelector("main")?.append(container);
      container.focus();
    }, role);
    for (const key of ["ArrowRight", "Space"]) await page.keyboard.press(key);
    await page.waitForTimeout(350);
    expect(await readCamera(page)).toEqual(initial);
    expect(
      await page.evaluate(() => {
        return ["=", "-", "0"].map((key) => {
          const event = new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          });
          document.activeElement?.dispatchEvent(event);
          return event.defaultPrevented;
        });
      }),
    ).toEqual([true, true, true]);
    await page
      .locator("#navigation-focus-fixture")
      .evaluate((element) => element.remove());
  }
  await page.waitForTimeout(1000);
  expect(await readCamera(page)).toEqual(initial);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.focus();
  expect(
    await composer.evaluate((element) =>
      ["=", "-", "0"].map((key) => {
        const event = new KeyboardEvent("keydown", {
          key,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ),
  ).toEqual([false, false, false]);
});

test("a right-click missed event preserves the selected object", async ({
  page,
}) => {
  await openRoom({ page });
  await selectItem(page);
  await page.mouse.click(100, 750, { button: "right" });
  await expect(
    page.getByRole("heading", { name: "Navigation table", exact: true }),
  ).toBeVisible();
  await page
    .locator("canvas")
    .first()
    .dispatchEvent("contextmenu", { button: 2, clientX: 100, clientY: 750 });
  await expect(
    page.getByRole("heading", { name: "Navigation table", exact: true }),
  ).toBeVisible();
});
