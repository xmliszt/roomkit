import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-b5-evidence";

for (const withText of [true, false]) {
  test(`send an attached photo ${withText ? "with text" : "without text"} and reload its thumbnail`, async ({
    page,
  }) => {
    const project = await createProject({
      name: "Photo chat",
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.6,
    });
    await page.goto(`/projects/${project.id}`);
    await page
      .getByTestId("composer")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "chair.png",
        mimeType: "image/png",
        buffer: readFileSync("packages/daemon/catalog/charging-port/thumb.png"),
      });
    await expect(
      page.getByRole("button", { name: "Remove chair.png" }),
    ).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    if (withText)
      await input.fill("[fake:photo-choice] What is in this photo?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const photo = page
      .getByRole("article", { name: "Your message" })
      .locator("img");
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect(photo).toHaveAttribute(
      "src",
      new RegExp(`/projects/${project.id}/photos/.+\\?size=thumb`),
    );
    await expect(
      page.getByRole("button", { name: "Remove chair.png" }),
    ).toHaveCount(0);
    await expect(input).toHaveValue("");
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, `chat-photo-${withText ? "text" : "only"}.png`),
    });
    await page.reload();
    await page.getByRole("button", { name: "chat", exact: true }).click();
    await expect
      .poll(() =>
        photo.evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
      )
      .toBeGreaterThan(0);
    await photo.click();
    const lightbox = page.getByRole("dialog").locator("img");
    await expect
      .poll(() =>
        lightbox.evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
      )
      .toBeGreaterThan(0);
  });
}
