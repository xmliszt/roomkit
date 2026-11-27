import { expect, test } from "@playwright/test";
import { mockGeneration } from "./mock-generation.ts";

test("a waiting alternative hides its progress bar and a failed method retries from its job row", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  fixture.startAlternatives({ itemId: "item-0" });
  fixture.updateAlternative({
    method: "trellis2",
    stage: "generating",
    progress: 0,
    lastLogLine: "queued",
    waitingFor: "machine",
  });
  await expect(
    page.getByRole("button", { name: "waiting for the machine", exact: true }),
  ).toBeVisible();
  const segment = page.getByRole("button", {
    name: "Open Chair 1 · TRELLIS.2 version",
    exact: true,
  });
  await expect(segment).toHaveAttribute(
    "title",
    "Chair 1 · TRELLIS.2 version · waiting for the machine",
  );
  await segment.click();
  const row = page.locator('details[data-job-id="alternative-0"]');
  await expect(
    page
      .locator('details[data-job-id="job-0"]')
      .getByRole("button", { name: /^Cancel / }),
  ).toHaveText("cancel");
  await expect(row.locator("summary .job-stage")).toHaveText("waiting");
  await expect(row.locator("summary .job-stage")).toHaveAttribute(
    "title",
    "waiting for the machine",
  );
  await expect(
    row.getByText("waiting for the machine", { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("progressbar")).toHaveCount(0);
  await expect(row.getByRole("log")).toContainText("RESULT fixture worker log");
  fixture.updateAlternative({
    method: "trellis2",
    stage: "failed",
    progress: 0.6,
    lastLogLine: "export",
    error: "TRELLIS.2 stalled",
  });
  await expect(row.getByRole("alert")).toHaveText("TRELLIS.2 stalled");
  await page.reload();
  await expect(page.getByTestId("item-tag")).toBeAttached();
  await segment.click();
  await expect(row.getByRole("log")).toContainText("RESULT fixture worker log");
  const retry = row.getByRole("button", {
    name: "Retry Chair 1 · TRELLIS.2 version",
    exact: true,
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fixture.sentCommands.filter(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "generation.alternatives",
      ),
    )
    .toEqual([
      expect.objectContaining({
        type: "generation.alternatives",
        projectId: fixture.projectId,
        itemId: "item-0",
        method: "trellis2",
      }),
    ]);
  await expect(row.getByRole("alert")).toHaveText("TRELLIS.2 stalled");
  await expect(
    page.locator('details[data-job-id="alternative-2"] summary'),
  ).toContainText("generating");
  await expect(
    page.getByRole("button", {
      name: "Open Chair 1 · SAM 3D version",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("a version that failed the asset check shows what came out", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  fixture.startAlternatives({ itemId: "item-0" });
  fixture.updateAlternative({
    method: "sam3d",
    stage: "failed",
    progress: 0.7,
    lastLogLine: "failed",
    error: "GLB validator found 2 errors",
    hasRejectedModel: true,
  });
  await page
    .getByRole("button", { name: "Open Chair 1 · SAM 3D version", exact: true })
    .click();
  const row = page.locator('details[data-job-id="alternative-1"]');
  await expect(row.getByRole("alert")).toHaveText(
    "GLB validator found 2 errors",
  );
  const preview = row.getByRole("img", { name: "Rejected model" });
  await expect(preview).toHaveAttribute(
    "src",
    new RegExp(
      `/projects/${fixture.projectId}/rejected/alternative-1/thumb\\.png$`,
    ),
  );
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
});
