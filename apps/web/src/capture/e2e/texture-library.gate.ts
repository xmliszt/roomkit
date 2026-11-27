import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";
import { SurfaceRecordSchema } from "../../../../../packages/daemon/src/surfaces/surface-record-schema.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 1.4, y: 1.4, z: 1.4 },
  targetM: { x: -1, y: 1.4, z: -1 },
};

test("texture library keeps unused assets, uses native scale, resets, copies and refreshes", async ({
  page,
}) => {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated test home");
  const project = await createProject({
    name: "Texture library",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const folder = join(root, "projects", project.id);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No texture context");
    context.fillStyle = "#ee3311";
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = "#1133ee";
    context.fillRect(64, 0, 64, 128);
    return canvas.toDataURL().split(",").at(1) ?? "";
  });
  function installAsset(input: { id: string; u: number; v: number }) {
    const path = join(folder, "assets", input.id);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "baseColor.png"), Buffer.from(png, "base64"));
    const material = {
      kind: "texture",
      textureAssetId: input.id,
      repeatSizeM: { u: input.u, v: input.v },
      roughness: 0.37,
    };
    writeFileSync(
      join(path, "meta.json"),
      JSON.stringify({
        id: input.id,
        kind: "surface",
        color: "#ffffff",
        material,
        provenance: {
          method: "surfacer",
          prompt: "stripes",
          sourcePhotoIds: [],
        },
      }),
    );
    return material;
  }
  const a = installAsset({ id: "pattern-a", u: 0.4, v: 0.6 });
  const b = installAsset({ id: "pattern-b", u: 0.9, v: 0.75 });
  installAsset({ id: "unused-pattern", u: 0.27, v: 0.22 });
  const records = ["pattern-a", "pattern-b", "unused-pattern"].map(
    (assetId, index) => ({
      assetId,
      room: project.scene.room,
      photoIds: [],
      prompt: "stripes",
      attempt: 1,
      job: {
        id: `texture-job-${index}`,
        kind: "surface",
        projectId: project.id,
        surfaceId: index === 0 ? "wall-1" : "wall-4",
        stage: "ready",
        progress: 1,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      },
    }),
  );
  function publish(input: {
    assetId: string;
    surfaceId: string;
    createdAt: string;
  }) {
    const record = {
      room: project.scene.room,
      photoIds: [],
      prompt: "stripes",
      attempt: 1,
      assetId: input.assetId,
      job: {
        id: crypto.randomUUID(),
        kind: "surface",
        projectId: project.id,
        surfaceId: input.surfaceId,
        stage: "ready",
        progress: 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    };
    const path = join(folder, ".planner", "jobs.json");
    const savedRecords = SurfaceRecordSchema.array().parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    writeFileSync(path, JSON.stringify([...savedRecords, record]));
  }
  writeFileSync(join(folder, ".planner", "jobs.json"), JSON.stringify(records));
  for (const [surfaceId, material] of [
    ["wall-1", a],
    ["wall-4", b],
  ]) {
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "surface.update",
        surfaceId,
        color: "#ffffff",
        material,
      },
    });
  }
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  let notify: (() => void) | undefined;
  await page.routeWebSocket(/\/ws$/, (socket) => {
    socket.connectToServer();
    notify = () =>
      socket.send(
        JSON.stringify({
          type: "event",
          event: {
            kind: "job.updated",
            job: {
              id: crypto.randomUUID(),
              kind: "surface",
              projectId: project.id,
              surfaceId: "wall-2",
              stage: "ready",
              progress: 1,
              createdAt: "2026-11-23T00:00:00.000Z",
              updatedAt: "2026-11-23T00:01:00.000Z",
            },
          },
        }),
      );
  });
  await page.setViewportSize(viewport);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("project-title")).toContainText(
    "Texture library",
  );
  await page.getByTestId("room-size").click();
  await page.getByRole("button", { name: "wall 4", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "Texture", exact: true });
  await picker.click();
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveCount(3);
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveText([
    "Wallpaper · from wall 4 · 0.27 × 0.22 m",
    "Wallpaper · from wall 4 · 0.90 × 0.75 m",
    "Wallpaper · from wall 1 · 0.40 × 0.60 m",
  ]);
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option")
      .locator("img"),
  ).toHaveCount(3);
  await expect
    .poll(async () =>
      page
        .getByRole("listbox", { name: "Texture", exact: true })
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await picker.press("b");
  await expect(
    page.getByRole("listbox", { name: "Texture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("option", {
      name: "Wallpaper · from wall 1 · 0.40 × 0.60 m",
      exact: true,
    })
    .click();
  const width = page.getByLabel("Repeat width · m", { exact: true });
  const length = page.getByLabel("Repeat length · m", { exact: true });
  await expect(width).toHaveValue("0.4");
  await expect(length).toHaveValue("0.6");
  await expect(page.getByLabel("Roughness", { exact: true })).toHaveValue(
    "0.37",
  );
  await picker.click();
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveCount(3);
  await picker.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Room", exact: true }),
  ).toBeVisible();
  await width.fill("1.1");
  await width.press("Enter");
  await page.getByRole("button", { name: "Reset scale", exact: true }).click();
  await expect(width).toHaveValue("0.4");
  await expect(length).toHaveValue("0.6");
  await page
    .getByRole("button", { name: "Apply to all walls", exact: true })
    .click();
  async function saved() {
    return ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId: project.id }),
    );
  }
  await expect
    .poll(async () =>
      Object.values((await saved()).scene.room.surfaces).map(
        (surface) => surface.material,
      ),
    )
    .toEqual([a, a, a, a]);
  await page.keyboard.press("Escape");
  const points = [1, 4].map((wall) =>
    Array.from({ length: 161 }, (_, index) => {
      const u = 0.05 + index * 0.01;
      return projectToScreen({
        camera,
        viewport,
        pointM:
          wall === 1 ? { x: -2, y: 1.4, z: -2 + u } : { x: -u, y: 1.4, z: -2 },
      });
    }),
  );
  async function periods() {
    const png = await page.screenshot();
    return page.evaluate(
      async (input) => {
        const bitmap = await createImageBitmap(
          new Blob([
            Uint8Array.from(atob(input.png), (char) => char.charCodeAt(0)),
          ]),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No pixels");
        context.drawImage(bitmap, 0, 0);
        return input.points.map((row) => {
          const red = row.map((point) => {
            const rgb = context.getImageData(
              Math.round(point.x),
              Math.round(point.y),
              1,
              1,
            ).data;
            return (rgb.at(0) ?? 0) > (rgb.at(2) ?? 255) + 50;
          });
          const edges = red.flatMap((value, index) =>
            value && red.at(index - 1) === false ? [index] : [],
          );
          const gaps = edges
            .slice(1)
            .map((edge, index) => edge - (edges.at(index) ?? 0));
          return gaps.length
            ? (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 0.01
            : 0;
        });
      },
      { png: png.toString("base64"), points },
    );
  }
  await expect
    .poll(async () =>
      (await periods()).every((period) => Math.abs(period - 0.4) < 0.02),
    )
    .toBe(true);
  const measured = await periods();
  const evidence = process.env.PLANNER_EVIDENCE_DIR;
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, "f2-pattern-periods.json"),
      JSON.stringify({ periodsM: measured, nativePeriodM: 0.4 }, undefined, 2),
    );
    await page.screenshot({ path: join(evidence, "f2-pattern-walls.png") });
  }
  expect(
    Math.abs((measured.at(0) ?? 0) / (measured.at(1) ?? 1) - 1),
  ).toBeLessThanOrEqual(0.05);
  await page.getByTestId("room-size").click();
  await page.getByRole("button", { name: "wall 4", exact: true }).click();
  await picker.click();
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveCount(3);
  await picker.press("End");
  await picker.press("w");
  const wrapped = await picker.getAttribute("aria-activedescendant");
  await expect(
    page.getByRole("option", {
      name: "Wallpaper · from wall 4 · 0.27 × 0.22 m",
      exact: true,
    }),
  ).toHaveAttribute("id", wrapped ?? "");
  await picker.press("End");
  await picker.press("ArrowUp");
  await expect(picker).toHaveAttribute(
    "aria-activedescendant",
    (await page
      .getByRole("option", {
        name: "Wallpaper · from wall 4 · 0.90 × 0.75 m",
        exact: true,
      })
      .getAttribute("id")) ?? "",
  );
  installAsset({ id: "finished-pattern", u: 0.5, v: 0.5 });
  publish({
    assetId: "finished-pattern",
    surfaceId: "wall-2",
    createdAt: "2026-11-23T00:00:00.000Z",
  });
  if (!notify) throw new Error("No browser socket");
  notify();
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveCount(4);
  await picker.press("Enter");
  await expect
    .poll(async () => (await saved()).scene.room.surfaces["wall-4"]?.material)
    .toMatchObject({
      kind: "texture",
      textureAssetId: "pattern-b",
      repeatSizeM: { u: 0.9, v: 0.75 },
    });
  await picker.click();
  await picker.press("End");
  await picker.press("Enter");
  await expect(width).toHaveValue("0.4");
  await page.getByLabel("Material", { exact: true }).selectOption("paint");
  await page.getByLabel("Material", { exact: true }).selectOption("texture");
  await expect(width).toHaveValue("0.5");
  await expect(length).toHaveValue("0.5");
  await page.reload();
  await expect(page.getByTestId("project-title")).toContainText(
    "Texture library",
  );
  await page.getByTestId("room-size").click();
  await page.getByRole("button", { name: "wall 4", exact: true }).click();
  await picker.click();
  await expect(
    page
      .getByRole("listbox", { name: "Texture", exact: true })
      .getByRole("option"),
  ).toHaveCount(4);
  await picker.press("Escape");
  await page.addStyleTag({
    content: '[role="listbox"] { max-height: 48px !important; }',
  });
  await picker.press("End");
  await expect
    .poll(async () =>
      picker.evaluate((element) => {
        const activeId = element.getAttribute("aria-activedescendant");
        const option = activeId ? document.getElementById(activeId) : undefined;
        const list = option?.parentElement;
        if (!option || !list) return false;
        const bounds = option.getBoundingClientRect();
        const parentBounds = list.getBoundingClientRect();
        return (
          bounds.top >= parentBounds.top && bounds.bottom <= parentBounds.bottom
        );
      }),
    )
    .toBe(true);
  const scrollList = page.getByRole("listbox", {
    name: "Texture",
    exact: true,
  });
  await scrollList.evaluate((element) => {
    element.style.setProperty("max-height", "112px", "important");
  });
  const listBounds = await scrollList.boundingBox();
  if (!listBounds) throw new Error("No list bounds");
  await page.mouse.move(listBounds.x + 20, listBounds.y + 10);
  await picker.press("Home");
  await page.mouse.wheel(0, 50);
  await expect
    .poll(() => scrollList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const scrolledTop = await scrollList.evaluate((element) => element.scrollTop);
  const hoveredOption = scrollList.getByRole("option").nth(2);
  const optionBounds = await hoveredOption.boundingBox();
  if (!optionBounds) throw new Error("No option bounds");
  expect(optionBounds.y).toBeGreaterThanOrEqual(listBounds.y);
  expect(optionBounds.y + optionBounds.height).toBeLessThanOrEqual(
    listBounds.y + listBounds.height,
  );
  await page.mouse.move(
    optionBounds.x + 20,
    optionBounds.y + optionBounds.height / 2,
  );
  await expect(picker).toHaveAttribute(
    "aria-activedescendant",
    (await hoveredOption.getAttribute("id")) ?? "",
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await scrollList.evaluate((element) => element.scrollTop)).toBe(
    scrolledTop,
  );
  await scrollList.evaluate((element) => {
    element.style.setProperty("max-height", "240px", "important");
  });
  await picker.press("Escape");
  const tileFolder = join(folder, "assets", "native-tiles");
  mkdirSync(tileFolder, { recursive: true });
  writeFileSync(join(tileFolder, "baseColor.png"), Buffer.from(png, "base64"));
  writeFileSync(
    join(tileFolder, "meta.json"),
    JSON.stringify({
      id: "native-tiles",
      kind: "surface",
      color: "#aabbcc",
      material: {
        kind: "tiles",
        tileSizeM: { u: 0.05, v: 0.08 },
        groutWidthM: 0.004,
        groutColor: "#cccccc",
        baseColor: "#aabbcc",
        roughness: 0.19,
        textureAssetId: "native-tiles",
      },
      provenance: {
        method: "surfacer",
        prompt: "tile fixture",
        sourcePhotoIds: [],
      },
    }),
  );
  publish({
    assetId: "native-tiles",
    surfaceId: "floor",
    createdAt: "2027-01-01T00:00:00.000Z",
  });
  notify();
  await page.getByLabel("Material", { exact: true }).selectOption("tiles");
  await page.getByLabel("Grout width · m", { exact: true }).fill("0.04");
  await page.getByLabel("Grout width · m", { exact: true }).press("Enter");
  await picker.click();
  await page
    .getByRole("option", { name: "Floor tiles · 0.05 × 0.08 m", exact: true })
    .click();
  await expect
    .poll(async () => (await saved()).scene.room.surfaces["wall-4"]?.material)
    .toEqual({
      kind: "tiles",
      tileSizeM: { u: 0.05, v: 0.08 },
      groutWidthM: 0.025,
      groutColor: "#b6b2a8",
      baseColor: "#aabbcc",
      roughness: 0.19,
      textureAssetId: "native-tiles",
    });
  installAsset({ id: "duplicate-pattern", u: 0.4, v: 0.6 });
  publish({
    assetId: "duplicate-pattern",
    surfaceId: "wall-1",
    createdAt: "2027-02-01T00:00:00.000Z",
  });
  notify();
  await picker.click();
  await expect(
    page.getByRole("option", {
      name: "Wallpaper · from wall 1 · 0.40 × 0.60 m",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("option", {
      name: "Wallpaper · from wall 1 · 0.40 × 0.60 m · 2",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await saved()).scene.room.surfaces["wall-4"]?.material)
    .toMatchObject({
      kind: "tiles",
      tileSizeM: { u: 0.4, v: 0.6 },
      baseColor: "#ffffff",
      textureAssetId: "duplicate-pattern",
    });
});

for (const shouldFail of [false, true]) {
  test(`texture library hides empty messages while loading and ${shouldFail ? "reports failure" : "stays mounted across panels"}`, async ({
    page,
  }) => {
    const root = process.env.PLANNER_E2E_HOME;
    if (!root) throw new Error("Missing isolated test home");
    const project = await createProject({
      name: "Loading textures",
      widthM: 4,
      depthM: 4,
      ceilingHeightM: 2.6,
    });
    const folder = join(
      root,
      "projects",
      project.id,
      "assets",
      "loading-pattern",
    );
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "baseColor.png"),
      readFileSync(new URL("./fixtures/b15-wallpaper.png", import.meta.url)),
    );
    const material = {
      kind: "texture",
      textureAssetId: "loading-pattern",
      repeatSizeM: { u: 0.4, v: 0.6 },
      roughness: 0.5,
    };
    writeFileSync(
      join(folder, "meta.json"),
      JSON.stringify({
        id: "loading-pattern",
        kind: "surface",
        color: "#ffffff",
        material,
        provenance: {
          method: "surfacer",
          prompt: "loading fixture",
          sourcePhotoIds: [],
        },
      }),
    );
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "surface.update",
        surfaceId: "wall-1",
        color: "#ffffff",
        material,
      },
    });
    let release: (() => void) | undefined;
    let readCount = 0;
    await page.routeWebSocket(/\/ws$/, (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (
          frame.type === "command.ack" &&
          frame.ok &&
          frame.result &&
          "assets" in frame.result
        ) {
          readCount++;
          if (!release) {
            release = () =>
              socket.send(
                shouldFail
                  ? JSON.stringify({
                      type: "command.ack",
                      requestId: frame.requestId,
                      ok: false,
                      error: "fixture failure",
                    })
                  : message,
              );
            return;
          }
        }
        socket.send(message);
      });
    });
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-title")).toContainText(
      "Loading textures",
    );
    await page.getByTestId("room-size").click();
    await page.getByRole("button", { name: "wall 1", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading textures…" }),
    ).toBeVisible();
    await expect(
      page.getByText("Texture unavailable", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Ask in chat to create wallpaper or a texture.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page
        .getByLabel("Material", { exact: true })
        .locator('option[value="texture"]:disabled'),
    ).toHaveCount(0);
    if (!release) throw new Error("No library response");
    release();
    if (shouldFail) {
      await expect(
        page.getByText("Could not load textures.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText("Ask in chat to create wallpaper or a texture.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    const picker = page.getByRole("combobox", { name: "Texture", exact: true });
    await expect(picker).toHaveText("Texture · 0.40 × 0.60 m▾");
    const settledReadCount = readCount;
    await page.getByTestId("room-size").click();
    await expect(
      page.getByRole("dialog", { name: "Room", exact: true }),
    ).toBeHidden();
    await page.getByTestId("room-size").click();
    await expect(picker).toHaveText("Texture · 0.40 × 0.60 m▾");
    expect(readCount).toBe(settledReadCount);
    await picker.click();
    const list = page.getByRole("listbox", { name: "Texture", exact: true });
    await list.evaluate((element) =>
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    await expect(list).toBeVisible();
    await picker.press("Tab");
    await expect(list).toBeHidden();
  });
}
