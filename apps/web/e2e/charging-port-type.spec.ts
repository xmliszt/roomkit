import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { createProject } from "../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

async function savedProject(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
}

async function addChargingPort(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "Add", exact: true });
  const builtIn = catalog.getByRole("group", { name: "Built-in" });
  await expect(builtIn.getByRole("option")).toHaveCount(7);
  await builtIn.getByRole("option").first().click();
  await expect(
    page.getByRole("button", { name: "Change charging port type" }),
  ).toBeVisible();
}

test("switching a charging port preserves its placement, undo and reload restore Type G, and additions remember the project's last pick", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assetErrors: string[] = [];
  const loadedModels: string[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/assets/")) return;
    if (!response.ok()) assetErrors.push(response.url());
    if (response.ok() && response.url().endsWith("/model.glb"))
      loadedModels.push(response.url());
  });
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function sendWithDelay(data) {
      if (
        typeof data === "string" &&
        data.includes('"item.update"') &&
        data.includes('"charging-port-type-a-b"')
      ) {
        setTimeout(() => send.call(this, data), 300);
        return;
      }
      send.call(this, data);
    };
  });
  const project = await createProject({
    name: "Socket types",
    widthM: 4.8,
    depthM: 3.4,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("room-size")).toHaveText(
    "4.80 × 3.40 × 2.60 m",
  );
  await addChargingPort(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const along = inspector.getByLabel("along");
  await along.fill("1.2");
  await along.press("Enter");
  const height = inspector.getByLabel("above floor");
  await height.fill("0.7");
  await height.press("Enter");
  await expect
    .poll(
      async () => (await savedProject(project.id)).scene.items.at(0)?.placement,
    )
    .toMatchObject({ alongM: 1.2, heightM: 0.7 });
  const original = (await savedProject(project.id)).scene.items.at(0);
  if (original === undefined) throw new Error("no added charging port");
  expect(original.model).toEqual({ kind: "asset", assetId: "charging-port" });
  const otherTab = await context.newPage();
  await otherTab.goto(`/projects/${project.id}`);
  await expect(otherTab.getByTestId("room-size")).toHaveText(
    "4.80 × 3.40 × 2.60 m",
  );
  const trigger = page.getByRole("button", {
    name: "Change charging port type",
  });
  await trigger.click();
  const picker = page.getByRole("dialog", {
    name: "Charging port type",
    exact: true,
  });
  await expect(picker.getByRole("button")).toHaveCount(7);
  await expect(picker.locator("img")).toHaveCount(7);
  await expect(
    picker.getByRole("button", {
      name: "Type G (UK, Malaysia, Singapore)",
      exact: true,
    }),
  ).toBeFocused();
  await expect
    .poll(() =>
      picker
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await expect(picker).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1440,
  );
  const evidence =
    process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a6-evidence";
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "charging-port-picker.png") });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(inspector).toBeVisible();
  await trigger.click();
  const beforeSwitch = await savedProject(project.id);
  await picker
    .getByRole("button", { name: "Type A/B (US, Japan)", exact: true })
    .click();
  await expect(picker).toBeHidden();
  await expect
    .poll(async () => (await savedProject(project.id)).scene.items.at(0))
    .toEqual({
      ...original,
      model: { kind: "asset", assetId: "charging-port-type-a-b" },
      sizeM: { width: 0.06985, height: 0.1143, depth: 0.0075 },
    });
  expect((await savedProject(project.id)).revision).toBe(
    beforeSwitch.revision + 1,
  );
  await expect
    .poll(() =>
      loadedModels.some((url) =>
        url.endsWith("/charging-port-type-a-b/model.glb"),
      ),
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await savedProject(project.id)).scene.items.at(0))
    .toEqual(original);
  const root = process.env.PLANNER_E2E_HOME;
  if (root === undefined) throw new Error("PLANNER_E2E_HOME is required");
  await expect
    .poll(() =>
      ProjectSchema.parse(
        JSON.parse(
          readFileSync(
            join(root, "projects", project.id, "project.json"),
            "utf8",
          ),
        ),
      ).scene.items.at(0),
    )
    .toEqual(original);
  await page.reload();
  await expect
    .poll(async () => {
      const items = await page.getByTestId("scene").getAttribute("data-items");
      return items === null
        ? undefined
        : z.array(ItemSchema).parse(JSON.parse(items));
    })
    .toEqual([original]);
  await addChargingPort(page);
  await expect
    .poll(async () => (await savedProject(project.id)).scene.items.at(1)?.model)
    .toEqual({ kind: "asset", assetId: "charging-port-type-a-b" });
  await addChargingPort(otherTab);
  await expect
    .poll(async () => (await savedProject(project.id)).scene.items.at(2)?.model)
    .toEqual({ kind: "asset", assetId: "charging-port-type-a-b" });
  await otherTab.close();
  const other = await createProject({
    name: "Other room",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${other.id}`);
  await expect(page.getByTestId("room-size")).toHaveText(
    "4.00 × 4.00 × 2.60 m",
  );
  await addChargingPort(page);
  await expect
    .poll(async () => (await savedProject(other.id)).scene.items.at(0)?.model)
    .toEqual({ kind: "asset", assetId: "charging-port" });
  expect(errors).toEqual([]);
  expect(assetErrors).toEqual([]);
});
