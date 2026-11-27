import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { createProject } from "./create-project.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

async function paintedShare(page: Page) {
  const box = await page.getByTestId("scene").boundingBox();
  if (box === null) throw new Error("scene not measured");
  const png = await page.screenshot({
    clip: {
      x: box.x + box.width * 0.25,
      y: box.y + box.height * 0.25,
      width: box.width * 0.5,
      height: box.height * 0.5,
    },
  });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let painted = 0;
    for (let index = 0; index < data.length; index += 4) {
      const difference =
        Math.abs((data[index] ?? 0) - 0xf4) +
        Math.abs((data[index + 1] ?? 0) - 0xf1) +
        Math.abs((data[index + 2] ?? 0) - 0xea);
      if (difference > 12) painted += 1;
    }
    return painted / (data.length / 4);
  }, png.toString("base64"));
}

async function shownCamera(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-camera");
  return value === null ? undefined : CameraSchema.parse(JSON.parse(value));
}

async function savedCamera(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  ).scene.camera;
}

test("create a room on /, open it, orbit, reload and get the same view back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Gate room");
  await page.getByLabel("Width").fill("3.00");
  await page.getByLabel("Depth").fill("5.20");
  await page.getByLabel("Ceiling height").fill("2.70");
  await page.getByRole("button", { name: "create" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = page.url().split("/").at(-1) ?? "";

  await expect(page.getByTestId("project-title")).toContainText("Gate room");
  await expect(page.getByTestId("room-size")).toHaveText(
    "3.00 × 5.20 × 2.70 m",
  );
  await expect.poll(() => shownCamera(page)).toBeDefined();
  await expect
    .poll(() => paintedShare(page), { message: "canvas share painted" })
    .toBeGreaterThan(0.02);
  await expect
    .poll(async () =>
      (
        await page
          .getByTestId("wall-dimension")
          .filter({ visible: true })
          .allInnerTexts()
      ).toSorted(),
    )
    .toEqual(["3.00 m", "5.20 m"]);

  await page.waitForTimeout(1000);
  expect(
    ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId }),
    ).revision,
    "opening a fresh project saves nothing",
  ).toBe(0);

  const before = await shownCamera(page);
  const box = await page.getByTestId("scene").boundingBox();
  if (box === null) throw new Error("scene not measured");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 220,
    box.y + box.height / 2 - 60,
    {
      steps: 12,
    },
  );
  await page.mouse.up();
  await expect.poll(() => shownCamera(page)).not.toEqual(before);
  await expect
    .poll(
      async () => {
        const shown = await shownCamera(page);
        return (
          JSON.stringify(await savedCamera(projectId)) === JSON.stringify(shown)
        );
      },
      { message: "orbited camera saved by the daemon", timeout: 10_000 },
    )
    .toBe(true);
  const orbited = await savedCamera(projectId);
  expect(orbited).not.toEqual(before);

  await page.reload();
  await expect(page.getByTestId("room-size")).toHaveText(
    "3.00 × 5.20 × 2.70 m",
  );
  await expect.poll(() => shownCamera(page)).toBeDefined();
  const restored = await shownCamera(page);
  for (const key of ["positionM", "targetM"] as const) {
    for (const axis of ["x", "y", "z"] as const) {
      expect(restored?.[key][axis]).toBeCloseTo(orbited[key][axis], 3);
    }
  }
  expect(errors, "console errors").toEqual([]);
});

test("stored Blueprint preference and B leave the 3D view unchanged", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("planner:scene-view", "blueprint");
  });
  const created = await createProject({
    name: "Single view",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.5,
  });
  await page.goto(`/projects/${created.id}`);
  await expect.poll(() => shownCamera(page)).toBeDefined();
  await expect.poll(() => paintedShare(page)).toBeGreaterThan(0.1);
  await expect(page.getByRole("button", { name: /blueprint/i })).toHaveCount(0);
  const camera = await shownCamera(page);
  const canvas = page.locator("canvas").first();
  await page.mouse.move(20, 20);
  const before = await canvas.screenshot();
  for (const key of ["b", "B"]) {
    await page.keyboard.press(key);
    expect(await canvas.screenshot()).toEqual(before);
    expect(await shownCamera(page)).toEqual(camera);
  }
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).not.toContainText(/blueprint/i);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /commands/ }).click();
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("blueprint");
  await expect(page.getByRole("dialog")).toContainText("no matching commands");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect.poll(() => paintedShare(page)).toBeGreaterThan(0.1);
  await page.screenshot({ path: testInfo.outputPath("single-3d-view.png") });
  expect(errors).toEqual([]);
});

test("F frames the room and wheel zoom saves the camera", async ({ page }) => {
  const created = await createProject({
    name: "Views",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.5,
  });
  const farCamera = {
    positionM: { x: 20, y: 12, z: 20 },
    targetM: { x: 0, y: 1, z: 0 },
  };
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: created.id,
    command: { type: "camera.set", camera: farCamera },
  });
  await page.goto(`/projects/${created.id}`);
  await expect.poll(() => shownCamera(page)).toEqual(farCamera);
  await expect.poll(() => paintedShare(page)).toBeGreaterThan(0.01);
  await page.keyboard.press("f");
  await expect.poll(() => shownCamera(page)).not.toEqual(farCamera);
  await expect
    .poll(
      async () =>
        JSON.stringify(await savedCamera(created.id)) ===
        JSON.stringify(await shownCamera(page)),
      { message: "framed camera saved by the daemon", timeout: 10_000 },
    )
    .toBe(true);

  const framed = await savedCamera(created.id);
  const box = await page.getByTestId("scene").boundingBox();
  if (box === null) throw new Error("scene not measured");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(
      async () => {
        const saved = await savedCamera(created.id);
        return (
          JSON.stringify(saved) !== JSON.stringify(framed) &&
          JSON.stringify(saved) === JSON.stringify(await shownCamera(page))
        );
      },
      { message: "wheel zoom saved by the daemon", timeout: 10_000 },
    )
    .toBe(true);
});

test("rename and remove a project from /", async ({ page }) => {
  const created = await createProject({
    name: "Rename me",
    widthM: 3,
    depthM: 3,
    ceilingHeightM: 2.5,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Rename Rename me" }).click();
  await page.getByLabel("Project name").fill("Study");
  await page.getByLabel("Project name").press("Enter");
  await expect(
    page.getByRole("link", { name: "Study", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Rename me", exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "Remove Study" }).click();
  await page.getByRole("button", { name: "confirm remove" }).click();
  await expect(
    page.getByRole("link", { name: "Study", exact: true }),
  ).toHaveCount(0);
  await expect(
    sendDaemonCommand({ type: "project.open", projectId: created.id }),
  ).rejects.toThrow();
});
