import { expect, test } from "@playwright/test";

test("the projects page renders and reaches the daemon", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Roomkit" })).toBeVisible();
  await expect(page.getByText("connecting to the daemon…")).toBeHidden();
  await expect(page.getByText("daemon not reachable")).toBeHidden();
});
