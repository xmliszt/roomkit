import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { mockGeneration } from "./mock-generation.ts";

test("the job grid stays aligned, opens Jobs by keyboard and keeps cancel hover menus", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 12 });
  fixture.stage({ index: 0, stage: "ready", progress: 1 });
  fixture.stage({ index: 1, stage: "ready", progress: 1 });
  await page.goto(`/projects/${fixture.projectId}`);
  const status = page.getByTestId("job-status");
  const grid = status.getByRole("button", { name: "Jobs: 2 of 12 ready" });
  await expect(grid).toBeVisible();
  await expect(status).not.toContainText(/\d+\/\d+ ready|no jobs/);
  await expect(status.locator(":scope > div:first-child > button")).toHaveCount(
    0,
  );
  const edges = await page.evaluate(() => {
    const grid = document.querySelector('[aria-label="Jobs: 2 of 12 ready"]');
    const sheet = document.querySelector(
      '[data-testid="job-status"] > div:last-child',
    );
    const rail = document.querySelector('[role="toolbar"][aria-label="Tools"]');
    if (!grid || !sheet || !rail)
      throw new Error("Missing bottom-left controls");
    return [grid, sheet, rail].map((node) => node.getBoundingClientRect().left);
  });
  expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(0.5);
  const evidence = resolve("docs/work-packages/evidence/a29-job-count");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: resolve(evidence, "bottom-left.png"),
    clip: { x: 0, y: 600, width: 360, height: 300 },
  });
  await grid.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await status
    .getByRole("button", { name: "Open model · Chair 3", exact: true })
    .hover();
  const cancel = status.getByRole("button", {
    name: "Cancel model · Chair 3",
    exact: true,
  });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "job.cancel",
        projectId: fixture.projectId,
        jobId: "job-2",
      }),
    );
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toBeHidden();
});
