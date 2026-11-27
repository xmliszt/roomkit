import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

test("snapshot downloads a PNG and renders its frozen view from the photo modal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const commands: ReturnType<typeof ClientCommandSchema.parse>[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const parsed = ClientCommandSchema.safeParse(
        JSON.parse(frame.payload.toString()),
      );
      if (parsed.success) commands.push(parsed.data);
    }),
  );
  await sendDaemonCommand({
    type: "blender.path.set",
    path: resolve("test/fake-tools/blender-photo.mjs"),
  });
  const project = await createProject({
    name: "Snapshot photo",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  const scene = page.getByTestId("scene");
  await expect(scene).toHaveAttribute("data-camera");
  await expect
    .poll(() => commands.some((c) => c.type === "view.report"))
    .toBe(true);
  await page.waitForTimeout(500);
  const reported = commands.findLast((c) => c.type === "view.report");
  if (reported?.type !== "view.report") throw new Error("No reported view");
  const frozenView = reported.view;
  const cameraBefore = await scene.getAttribute("data-camera");
  let isSaving = false;
  let releaseSave = () => {};
  const savePaused = new Promise<void>((resolveSave) => {
    releaseSave = resolveSave;
  });
  await page.route("**/snapshots", async (route) => {
    const response = await route.fetch();
    isSaving = true;
    await savePaused;
    await route.fulfill({ response });
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Snapshot", exact: true }).click();
  await expect.poll(() => isSaving).toBe(true);
  await page
    .locator("canvas")
    .first()
    .hover({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(0, 250);
  await expect(scene).not.toHaveAttribute("data-camera", cameraBefore ?? "");
  releaseSave();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const modal = page.getByRole("dialog", {
    name: "Snapshot photo",
    exact: true,
  });
  await expect(modal).toBeVisible();
  const photo = modal.getByRole("img", { name: "Snapshot of the room" });
  await expect(photo).toBeVisible();
  expect(
    await photo.evaluate(
      (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Render photo", exact: true }),
  ).toHaveCount(0);
  mkdirSync(resolve("docs/work-packages/evidence"), { recursive: true });
  await page.screenshot({
    path: resolve("docs/work-packages/evidence/a27-photo-modal.png"),
  });
  await modal
    .getByRole("button", { name: "Render realistic photo", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: /Rendering…/ }),
  ).toBeDisabled();
  await expect(
    modal.getByText(
      "Rendering… about 2 minutes. The photo will appear in chat.",
    ),
  ).toBeVisible();
  const renders = commands.filter((command) => command.type === "render.start");
  expect(renders).toHaveLength(1);
  expect(renders.at(0)?.view).toEqual(frozenView);
  await modal.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Snapshot", exact: true }).click();
  await expect(modal).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(modal).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("canvas")
    .first()
    .click({ position: { x: 100, y: 100 } });
  await page.keyboard.press("Backslash");
  await expect(page.getByTestId("chrome")).toHaveClass("invisible");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByTestId("chrome")).toHaveClass("invisible");
  expect(
    commands.filter((command) => command.type === "render.start"),
  ).toHaveLength(1);
});
