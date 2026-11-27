import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { z } from "zod";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";
import { mockGeneration } from "./mock-generation.ts";

const viewport = { width: 1440, height: 900 };
const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a17-evidence";

async function setup(options: {
  page: Page;
  count?: number;
  ready?: boolean;
  generationAck?: Promise<void>;
  edge?: { x: number; y: number };
}) {
  await options.page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockGeneration({
    page: options.page,
    count: options.count ?? 1,
    ...(options.generationAck ? { generationAck: options.generationAck } : {}),
  });
  if (options.ready !== false) fixture.ready(0);
  if (options.edge) {
    fixture.camera.positionM.y = 2;
    fixture.camera.positionM.z = 2;
    const camera = new PerspectiveCamera(
      32,
      viewport.width / viewport.height,
      0.1,
      200,
    );
    camera.position.set(
      fixture.camera.positionM.x,
      fixture.camera.positionM.y,
      fixture.camera.positionM.z,
    );
    camera.lookAt(
      fixture.camera.targetM.x,
      fixture.camera.targetM.y,
      fixture.camera.targetM.z,
    );
    camera.updateMatrixWorld();
    const center = new Vector3(0, 0.5, -1);
    const projected = center.clone().project(camera);
    const edge = new Vector3(
      (options.edge.x / viewport.width) * 2 - 1,
      1 - (options.edge.y / viewport.height) * 2,
      projected.z,
    ).unproject(camera);
    const shift = center.sub(edge);
    for (const point of [fixture.camera.positionM, fixture.camera.targetM]) {
      point.x = Math.round((point.x + shift.x) * 10000) / 10000;
      point.y = Math.round((point.y + shift.y) * 10000) / 10000;
      point.z = Math.round((point.z + shift.z) * 10000) / 10000;
    }
  }
  await options.page.goto(`/projects/${fixture.projectId}`);
  await expect(options.page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(fixture.camera),
  );
  await expect(
    options.page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  if (options.ready !== false)
    await expect(options.page.getByTestId("item-tag").first()).toHaveAttribute(
      "data-load-in-stage",
      "done",
    );
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: options.count === 2 ? -1 : 0, y: 0.5, z: -1 },
    viewport,
  });
  return { ...fixture, point };
}

async function open(options: { page: Page; point: { x: number; y: number } }) {
  await options.page.mouse.click(options.point.x, options.point.y, {
    button: "right",
  });
  await expect(
    options.page.getByRole("menu", { name: "Chair 1", exact: true }),
  ).toBeVisible();
}

async function items(page: Page) {
  return z
    .array(ItemSchema)
    .parse(
      JSON.parse(
        (await page.getByTestId("scene").getAttribute("data-items")) ?? "[]",
      ),
    );
}

test("context menu opens at the pointer, edits, quotes once, and dismisses", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 2 });
  await open({ page, point: fixture.point });
  const menu = page.getByRole("menu", { name: "Chair 1", exact: true });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Edit",
    "Regenerate…",
    "Send to Chat",
    "DuplicateD",
    "Duplicate mirrored",
    "Mirror",
    "Lock",
    "Delete",
  ]);
  const bounds = await menu.boundingBox();
  expect(bounds?.x).toBeCloseTo(fixture.point.x, 0);
  expect(bounds?.y).toBeCloseTo(fixture.point.y, 0);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "object-context-menu.png") });
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Selected" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await open({ page, point: fixture.point });
  await menu
    .getByRole("menuitem", { name: "Send to Chat", exact: true })
    .click();
  const chip = page.getByRole("button", {
    name: "Remove reference to Chair 1",
  });
  await expect(chip).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeFocused();
  await open({ page, point: fixture.point });
  await menu
    .getByRole("menuitem", { name: "Send to Chat", exact: true })
    .click();
  await expect(chip).toHaveCount(1);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Backslash");
  await open({ page, point: fixture.point });
  await menu
    .getByRole("menuitem", { name: "Send to Chat", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeFocused();
  const other = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 1, y: 0.6, z: -1 },
    viewport,
  });
  await page.mouse.click(other.x, other.y);
  await expect(
    page.getByRole("button", { name: "Remove reference to Chair 2" }),
  ).toHaveCount(0);
  await open({ page, point: fixture.point });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeFocused();
  await open({ page, point: fixture.point });
  await page.mouse.click(300, 200);
  await expect(menu).toHaveCount(0);
  await open({ page, point: fixture.point });
  await page.mouse.move(300, 700);
  await page.mouse.wheel(0, 100);
  await expect(menu).toHaveCount(0);
});

test("right drag pans without opening; empty floor and cancelled gestures show no menu", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const before = await page.getByTestId("scene").getAttribute("data-camera");
  await page.mouse.move(fixture.point.x, fixture.point.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(fixture.point.x + 90, fixture.point.y + 50, {
    steps: 8,
  });
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-camera",
    before ?? "",
  );
  await page.mouse.click(300, 700, { button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a language switch preserves keyboard focus in the object menu", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await open({ page, point: fixture.point });
  const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
  await expect(edit).toBeFocused();
  try {
    await sendDaemonCommand({ type: "language.set", locale: "fr" });
    const localizedEdit = page.getByRole("menuitem", {
      name: "Modifier",
      exact: true,
    });
    await expect(localizedEdit).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("menuitem", { name: "Supprimer", exact: true }),
    ).toBeFocused();
  } finally {
    await sendDaemonCommand({ type: "language.set", locale: "en" });
  }
});

test("menu actions share undo and keyboard-only activation", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixture = await setup({ page });
  const original = await items(page);
  await page.mouse.click(fixture.point.x, fixture.point.y);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Edit", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Selected" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const action of [
    "Duplicate",
    "Duplicate mirrored",
    "Mirror",
    "Lock",
    "Delete",
  ]) {
    await open({ page, point: fixture.point });
    await page
      .getByRole("menuitem", {
        name: action,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const current = await items(page);
        if (action === "Delete") return current.length === 0;
        if (action === "Duplicate" || action === "Duplicate mirrored")
          return (
            current.length === 2 &&
            (action === "Duplicate" || current.at(1)?.mirrored === true)
          );
        return action === "Mirror"
          ? current.at(0)?.mirrored === true
          : current.at(0)?.locked === true;
      })
      .toBe(true);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => items(page)).toEqual(original);
  }
  await open({ page, point: fixture.point });
  await page.getByRole("menuitem", { name: "Lock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "unlock", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await open({ page, point: fixture.point });
  await page.getByRole("menuitem", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "lock", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => items(page)).toEqual(original);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ContextMenu");
  await expect(page.getByRole("menu")).toBeVisible();
});

test("regeneration passes notes, versions reuse the command, and held items start", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await open({ page, point: fixture.point });
  await page
    .getByRole("menuitem", { name: "Regenerate…", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Regenerate Chair 1" });
  await expect(form.getByRole("textbox")).toBeFocused();
  await form.getByRole("textbox").fill("Make the legs slimmer");
  await form.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.regenerate",
        itemId: "item-0",
        notes: "Make the legs slimmer",
      }),
    );
  await open({ page, point: fixture.point });
  await expect(
    page.getByRole("menuitem", { name: "Regenerate…", exact: true }),
  ).toBeDisabled();
});

test("Try another version and Model this use their existing generation commands", async ({
  page,
}) => {
  const fixture = await setup({ page, ready: false });
  await open({ page, point: fixture.point });
  await expect(
    page.getByRole("menuitem", { name: "Regenerate…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  fixture.stage({ index: 0, stage: "held" });
  await open({ page, point: fixture.point });
  await expect(
    page.getByRole("menuitem", { name: "Regenerate…", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Model this", exact: true }).click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({ type: "generation.start", itemId: "item-0" }),
    );
  fixture.ready(0);
  await open({ page, point: fixture.point });
  await page
    .getByRole("menuitem", { name: "Regenerate…", exact: true })
    .click();
  await page
    .getByRole("form", { name: "Regenerate Chair 1" })
    .getByRole("button", { name: "Try another version" })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.alternatives",
        itemId: "item-0",
      }),
    );
});

for (const edge of [
  { x: 8, y: 8 },
  { x: 1432, y: 8 },
  { x: 8, y: 892 },
  { x: 1432, y: 892 },
]) {
  test(`context menu stays in the viewport at ${edge.x}, ${edge.y}`, async ({
    page,
  }) => {
    const fixture = await setup({ page, edge });
    await page.locator("canvas").first().focus();
    await page.keyboard.press("Backslash");
    await open({ page, point: fixture.point });
    const bounds = await page.getByTestId("object-context-menu").boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Menu has no bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  });
}

test("right-click uses a 4 px maximum movement threshold", async ({ page }) => {
  const fixture = await setup({ page });
  await page.mouse.move(fixture.point.x, fixture.point.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(fixture.point.x + 3, fixture.point.y);
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(fixture.point.x, fixture.point.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(fixture.point.x + 4, fixture.point.y);
  await page.mouse.move(fixture.point.x, fixture.point.y);
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("menu shortcut hints duplicate and delete with undo", async ({ page }) => {
  const fixture = await setup({ page });
  const original = await items(page);
  for (const shortcut of ["Meta+d", "Control+d", "Backspace", "Delete"]) {
    await open({ page, point: fixture.point });
    await page.keyboard.press(shortcut);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect
      .poll(async () => (await items(page)).length)
      .toBe(shortcut.endsWith("+d") ? 2 : 0);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => items(page)).toEqual(original);
  }
});

for (const destination of ["menu", "composer"]) {
  test(`a delayed generation acknowledgment preserves the newer ${destination}`, async ({
    page,
  }) => {
    const acknowledgment = Promise.withResolvers<void>();
    const fixture = await setup({
      page,
      count: 2,
      generationAck: acknowledgment.promise,
    });
    await open({ page, point: fixture.point });
    await page
      .getByRole("menuitem", { name: "Regenerate…", exact: true })
      .click();
    await page
      .getByRole("form", { name: "Regenerate Chair 1" })
      .getByRole("button", { name: "Regenerate", exact: true })
      .click();
    await expect
      .poll(() => fixture.sentCommands)
      .toContainEqual(
        expect.objectContaining({ type: "generation.regenerate" }),
      );
    await page.keyboard.press("Escape");
    const other = projectToScreen({
      camera: fixture.camera,
      pointM: { x: 1, y: 0.6, z: -1 },
      viewport,
    });
    await page.mouse.click(other.x, other.y, { button: "right" });
    const nextMenu = page.getByRole("menu", { name: "Chair 2", exact: true });
    await expect(nextMenu).toBeVisible();
    const prompt = page.getByRole("textbox", { name: "Message", exact: true });
    if (destination === "composer") await prompt.click();
    acknowledgment.resolve();
    await fixture.generationAcknowledged;
    fixture.stage({ index: 1, stage: "generating" });
    await expect(
      page.getByTestId("item-tag").filter({ hasText: "chair 2" }),
    ).toContainText("generating");
    if (destination === "menu") {
      await expect(nextMenu).toBeVisible();
      await expect(
        nextMenu.getByRole("menuitem", { name: "Edit", exact: true }),
      ).toBeFocused();
    } else await expect(prompt).toBeFocused();
  });
}

test("Send to Chat explains the limit at ten references", async ({ page }) => {
  const fixture = await setup({ page, count: 11 });
  const prompt = page.getByRole("textbox", { name: "Message", exact: true });
  for (const index of Array.from({ length: 10 }, (_, index) => index + 2)) {
    await prompt.fill(`@Chair ${index}`);
    await page
      .getByRole("option", { name: `Chair ${index}`, exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: /^Remove reference to/ }),
  ).toHaveCount(10);
  const first = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -1, y: 0.5, z: -1 },
    viewport,
  });
  await open({ page, point: first });
  const send = page.getByRole("menuitem", {
    name: "Send to Chat",
    exact: true,
  });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute("title", /10 objects maximum/);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Remove reference to Chair 2", exact: true })
    .click();
  await open({ page, point: first });
  await send.click();
  await expect(
    page.getByRole("button", {
      name: "Remove reference to Chair 1",
      exact: true,
    }),
  ).toBeVisible();
});

test("a scrolling note stays open and Command+Enter submits every line", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await open({ page, point: fixture.point });
  await page
    .getByRole("menuitem", { name: "Regenerate…", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Regenerate Chair 1" });
  const notes = form.getByRole("textbox");
  const text =
    "Make the seat wider\nKeep the legs thin\nUse dark wood\nLeave the back open";
  await notes.fill(text);
  await notes.press("End");
  await expect
    .poll(() =>
      notes.evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await notes.hover();
  await page.mouse.wheel(0, 100);
  await expect(form).toBeVisible();
  await expect(notes).toHaveValue(text);
  await notes.press("Meta+Enter");
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({ type: "generation.regenerate", notes: text }),
    );
});

test("F moves the camera and closes an open menu without scrolling", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const before = await page.getByTestId("scene").getAttribute("data-camera");
  await open({ page, point: fixture.point });
  await page.keyboard.press("f");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-camera",
    before ?? "",
  );
});

for (const movement of ["frame", "wheel"]) {
  test(`${movement} easing started before opening leaves the menu open`, async ({
    page,
  }) => {
    const fixture = await setup({ page });
    await page.mouse.click(fixture.point.x, fixture.point.y);
    await expect(
      page.getByRole("complementary", { name: "Inspector" }),
    ).toBeVisible();
    await page.locator("canvas").first().focus();
    const result = await page
      .locator("canvas")
      .first()
      .evaluate(async (canvas, movement) => {
        async function nextFrame() {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        const label = document.querySelector('[data-testid="item-tag"]');
        if (!label) throw new Error("Missing selected item label");
        const startingY = label.getBoundingClientRect().y;
        const deadlineMs = performance.now() + 5000;
        if (movement === "frame") {
          const scene = document.querySelector('[data-testid="scene"]');
          const before = scene?.getAttribute("data-camera");
          canvas.dispatchEvent(
            new KeyboardEvent("keydown", { key: "f", bubbles: true }),
          );
          for (
            let frame = 0;
            frame < 120 && scene?.getAttribute("data-camera") === before;
            frame++
          )
            await nextFrame();
        } else
          canvas.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: -240,
              clientX: 500,
              clientY: 300,
              bubbles: true,
              cancelable: true,
            }),
          );
        while (
          label.getBoundingClientRect().y === startingY &&
          performance.now() < deadlineMs
        )
          await nextFrame();
        if (label.getBoundingClientRect().y === startingY)
          throw new Error("Camera did not move before opening the menu");
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
          }),
        );
        await nextFrame();
        while (
          !document.querySelector('[role="menu"]') &&
          performance.now() < deadlineMs
        )
          await nextFrame();
        const positions: number[] = [];
        const menuVisibility: boolean[] = [];
        for (let frame = 0; frame < 60; frame += 1) {
          const label = document.querySelector('[data-testid="item-tag"]');
          if (label) positions.push(label.getBoundingClientRect().y);
          menuVisibility.push(document.querySelector('[role="menu"]') !== null);
          await nextFrame();
        }
        return { positions, menuVisibility };
      }, movement);
    expect(result.menuVisibility.every(Boolean)).toBe(true);
    expect(new Set(result.positions).size).toBeGreaterThan(1);
    await expect(
      page.getByRole("menu", { name: "Chair 1", exact: true }),
    ).toBeVisible();
  });
}

test("Control-click on macOS opens the menu", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
  );
  const fixture = await setup({ page });
  await page.keyboard.down("Control");
  await page.mouse.click(fixture.point.x, fixture.point.y);
  await page.keyboard.up("Control");
  await expect(
    page.getByRole("menu", { name: "Chair 1", exact: true }),
  ).toBeVisible();
});

test("queued items share running actions and disabled shortcuts", async ({
  page,
}) => {
  const fixture = await setup({ page, ready: false });
  await open({ page, point: fixture.point });
  await expect(
    page.getByRole("menuitem", { name: "Regenerate…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Duplicate", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Meta+d");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(
    page
      .getByTestId("inspector-body")
      .getByText("generating…", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("inspector-body")
      .getByRole("button", { name: "model this", exact: true }),
  ).toHaveCount(0);
});

test("deleting the selected item remotely clears its menu target", async ({
  page,
}) => {
  const fixture = await setup({ page });
  const original = (await items(page)).at(0);
  if (!original) throw new Error("Expected the fixture item");
  await open({ page, point: fixture.point });
  fixture.apply({ command: { type: "item.remove", itemId: original.id } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  fixture.apply({ command: { type: "item.add", item: original } });
  await expect.poll(() => items(page)).toEqual([original]);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("menu focus and hover layer the accent over opaque paper", async ({
  page,
}) => {
  const fixture = await setup({ page });
  await open({ page, point: fixture.point });
  const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
  for (const activate of [
    () => edit.focus(),
    async () => {
      await edit.evaluate((element) => element.blur());
      await edit.hover();
      await expect(edit).not.toBeFocused();
    },
  ]) {
    await activate();
    await expect
      .poll(() =>
        edit.evaluate((element) => ({
          fill: getComputedStyle(element).backgroundColor,
          tint: getComputedStyle(element).backgroundImage,
        })),
      )
      .toEqual({
        fill: "rgb(244, 241, 234)",
        tint: expect.stringContaining("linear-gradient"),
      });
  }
  await edit.evaluate((element) => element.blur());
  await page
    .getByRole("menu")
    .dispatchEvent("keydown", { key: "ArrowUp", bubbles: true });
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeFocused();
});

test("charging ports have no generation actions in either surface", async ({
  page,
}) => {
  const fixture = await setup({ page });
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: { model: { kind: "asset", assetId: CHARGING_PORT.assetId } },
    },
  });
  await expect
    .poll(async () => (await items(page)).at(0)?.model)
    .toEqual({ kind: "asset", assetId: CHARGING_PORT.assetId });
  await open({ page, point: fixture.point });
  await expect(
    page.getByRole("menuitem", { name: "Regenerate…", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Model this", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(
    page
      .getByTestId("inspector-body")
      .getByRole("button", { name: "regenerate", exact: true }),
  ).toHaveCount(0);
});

test("immediate room framing closes an open menu", async ({ page }) => {
  const fixture = await setup({ page });
  const before = await page.getByTestId("scene").getAttribute("data-camera");
  await open({ page, point: fixture.point });
  fixture.apply({
    command: {
      type: "room.update",
      walls: createRectangularScene({
        widthM: 12,
        depthM: 10,
        ceilingHeightM: 2.6,
      }).room.walls,
    },
  });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-camera",
    before ?? "",
  );
});
