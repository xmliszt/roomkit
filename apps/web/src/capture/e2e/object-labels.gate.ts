import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { mockGeneration } from "../../../e2e/mock-generation.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a9-evidence";
mkdirSync(evidence, { recursive: true });

test("labels follow hover and selection; L, the button and palette share the saved choice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await mockGeneration({ page, count: 3 });
  fixture.ready(2);
  await page.goto(`/projects/${fixture.projectId}`);
  const tags = page.getByTestId("item-tag");
  const visibleTags = page.locator('[data-testid="item-tag"]:visible');
  const toggle = page.getByRole("button", { name: "labelsL", exact: true });
  await expect(tags).toHaveCount(3);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    /positionM/,
  );
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(visibleTags).toHaveCount(0);
  fixture.stage({ index: 1, stage: "generating", progress: 0.4 });
  await expect(tags.nth(1)).toHaveText("chair 2 · generating");
  await expect(visibleTags).toHaveCount(0);

  const first = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -1, y: 0.6, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  const ready = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -1, y: 0.5, z: 1 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.move(first.x, first.y);
  await expect(visibleTags).toHaveCount(1);
  await expect(visibleTags).toHaveText("chair 1 · queued");
  await page.screenshot({ path: join(evidence, "labels-off-hovered.png") });
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(20, 400);
  await expect(visibleTags).toHaveText("chair 1 · queued");
  await page.keyboard.press("Escape");
  await expect(visibleTags).toHaveCount(0);
  await page.mouse.move(ready.x, ready.y);
  await expect(visibleTags).toHaveText("chair 3 · ready");
  await page.mouse.click(ready.x, ready.y);
  await page.mouse.move(20, 400);
  await expect(visibleTags).toHaveText("chair 3 · ready");
  await page.keyboard.press("Escape");
  await expect(visibleTags).toHaveCount(0);

  await page.keyboard.press("l");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(visibleTags).toHaveCount(3);
  await page.screenshot({ path: join(evidence, "labels-on.png") });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(visibleTags).toHaveCount(3);
  await toggle.click();
  await expect(visibleTags).toHaveCount(0);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(visibleTags).toHaveCount(0);

  await page.getByRole("button", { name: /commands/ }).click();
  await page.getByRole("combobox", { name: "Search commands" }).fill("labels");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("combobox", { name: "Search commands" }).press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(visibleTags).toHaveCount(3);
  fixture.stage({ index: 0, stage: "failed" });
  await expect(tags.nth(0)).toHaveText("chair 1 · failed");
  await expect(tags.nth(0)).toHaveClass(/text-danger/);
});

test("unavailable browser storage keeps labels usable and off by default", async ({
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
  const fixture = await mockGeneration({ page, count: 3 });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag")).toHaveCount(3);
  const visibleTags = page.locator('[data-testid="item-tag"]:visible');
  await expect(visibleTags).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(visibleTags).toHaveCount(3);
  await page.keyboard.press("l");
  await expect(visibleTags).toHaveCount(0);
  expect(errors).toEqual([]);
});
