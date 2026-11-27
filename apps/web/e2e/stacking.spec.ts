import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { expect, type Locator, test } from "@playwright/test";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { mockGeneration } from "./mock-generation.ts";

async function expectTopmost(options: { surface: Locator; item: Locator }) {
  await expect(options.surface).toBeVisible();
  await expect(options.item).toBeVisible();
  const surface = await options.surface.elementHandle();
  await expect
    .poll(() =>
      options.item.evaluate((item, surface) => {
        const bounds = item.getBoundingClientRect();
        return [2, bounds.width / 2].every((offsetPx) => {
          return [bounds.height / 2, bounds.height - 2].every((offsetY) => {
            const top = document.elementFromPoint(
              bounds.left + offsetPx,
              bounds.top + offsetY,
            );
            return top !== null && surface?.contains(top) && item.contains(top);
          });
        });
      }, surface),
    )
    .toBe(true);
}

test("floating menus cover editor controls and the project tooltip follows truncation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const name = "Living room with a project name longer than the top strip";
  const fixture = await mockGeneration({ page, count: 1, name });
  fixture.ready(0);
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 0, y: 0.5, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  const title = page.getByTestId("project-title");
  const text = title.locator("span").first();
  await expect(text).toHaveAttribute("title", name);
  await title.click();
  const project = page.getByRole("menu", { name: "Project", exact: true });
  await expect(text).not.toHaveAttribute("title");
  await expectTopmost({
    surface: project,
    item: project.getByRole("menuitem").first(),
  });
  const evidence = resolve("docs/work-packages/evidence/a30-stacking");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "project-menu.png") });
  await page.getByTestId("room-size").click();
  await expect(project).toBeHidden();
  const room = page.getByRole("dialog", { name: "Room", exact: true });
  await expectTopmost({
    surface: room,
    item: room.getByRole("textbox").first(),
  });
  await page.getByTestId("room-size").click();
  await expect(text).toHaveAttribute("title", name);
  await text.evaluate((element) => {
    element.style.position = "fixed";
    element.style.width = "1000px";
  });
  await expect(text).not.toHaveAttribute("title");
  await text.evaluate((element) => element.removeAttribute("style"));
  await expect(text).toHaveAttribute("title", name);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add", exact: true });
  await expectTopmost({ surface: add, item: add.getByRole("option").first() });
  await expect(add.getByRole("combobox")).toBeFocused();
  await page.screenshot({ path: resolve(evidence, "add-picker.png") });
  await page.keyboard.press("Escape");
  await expect(add).toBeHidden();

  await page.mouse.click(point.x, point.y, { button: "right" });
  const context = page.getByRole("menu", { name: "Chair 1", exact: true });
  await expectTopmost({
    surface: context,
    item: context.getByRole("menuitem").first(),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /commands/ }).click();
  const commands = page.getByRole("dialog", { name: "Commands", exact: true });
  await expectTopmost({
    surface: commands,
    item: commands.getByRole("option").first(),
  });
  await page.keyboard.press("Escape");
  await expect(commands).toBeHidden();
  const prompt = page.getByRole("textbox", { name: "Message", exact: true });
  await prompt.fill("@Chair");
  const mentions = page.getByRole("listbox", {
    name: "Room objects",
    exact: true,
  });
  await expectTopmost({
    surface: mentions,
    item: mentions.getByRole("option").first(),
  });
  await prompt.press("Escape");
  fixture.stage({ index: 0, stage: "queued" });
  const jobs = page.getByTestId("job-status");
  await jobs.getByRole("button", { name: /^Open/ }).first().hover();
  const cancel = jobs.getByRole("button", { name: /^Cancel/ });
  await expectTopmost({ surface: cancel.locator(".."), item: cancel });
  await page.mouse.move(700, 400);
  await page.setViewportSize({ width: 1000, height: 600 });
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: {
        model: { kind: "asset", assetId: CHARGING_PORT.assetId },
        sizeM: CHARGING_PORT.sizeM,
      },
    },
  });
  await page.getByRole("tab", { name: "Selected", exact: true }).click();
  await page.getByRole("button", { name: "Change charging port type" }).click();
  const ports = page.getByRole("dialog", {
    name: "Charging port type",
    exact: true,
  });
  const lastPort = ports.getByRole("button").last();
  await lastPort.scrollIntoViewIfNeeded();
  await expectTopmost({ surface: ports, item: lastPort });
  const bounds = await lastPort.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 600) + (bounds?.height ?? 1)).toBeLessThanOrEqual(600);
});
