import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { generationFixture } from "../apps/web/e2e/generation-fixture.ts";
import { buildGlb } from "../apps/web/src/capture/e2e/build-glb.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

async function samplePixel(options: {
  page: Page;
  point: { x: number; y: number };
}) {
  const png = await options.page.locator("canvas").first().screenshot();
  return options.page.evaluate(
    async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([
          Uint8Array.from(atob(input.png), (character) =>
            character.charCodeAt(0),
          ),
        ]),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(
        Math.round(input.point.x) - 1,
        Math.round(input.point.y) - 1,
        3,
        3,
      ).data;
      const channels = [0, 1, 2].map(
        (channel) =>
          Array.from(
            { length: 9 },
            (_, index) => pixels[index * 4 + channel] ?? 0,
          ).reduce((sum, value) => sum + value, 0) / 9,
      );
      return {
        red: channels.at(0) ?? 0,
        green: channels.at(1) ?? 0,
        blue: channels.at(2) ?? 0,
        dark: Array.from(
          { length: 9 },
          (_, index) => pixels[index * 4] ?? 255,
        ).filter((value) => value < 220).length,
      };
    },
    { png: png.toString("base64"), point: options.point },
  );
}

test("opening cuts the rendered wall, clamps its frame and undoes from the inspector", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const project = await createProject({
    name: "Wall openings",
    widthM: 5,
    depthM: 5,
    ceilingHeightM: 3,
  });
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  const folder = join(root, "projects", project.id, "assets", "door-frame");
  mkdirSync(folder, { recursive: true });
  const fixture = generationFixture();
  const length = fixture.glb.readUInt32LE(12);
  const original = JSON.parse(fixture.glb.subarray(20, 20 + length).toString());
  const nodes = [
    { mesh: 0, translation: [-0.95, -1, 0.425], scale: [0.1, 2, 0.85] },
    { mesh: 0, translation: [0.95, -1, 0.425], scale: [0.1, 2, 0.85] },
    { mesh: 0, translation: [0, 0.9, 0.425], scale: [1.8, 0.1, 0.85] },
  ];
  writeFileSync(
    join(folder, "model.glb"),
    buildGlb({
      json: { ...original, scenes: [{ nodes: [0, 1, 2] }], nodes },
      binary: fixture.glb.subarray(28 + length),
    }),
  );
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "door-frame",
      kind: "catalog",
      nativeSizeM: { width: 2, height: 2, depth: 0.85 },
      mount: "wall",
      triangleCount: 36,
      hasColorMask: false,
      provenance: { method: "test", sourcePhotoIds: [] },
    }),
  );
  const item = {
    id: "door",
    name: "Sliding door",
    model: { kind: "asset", assetId: "door-frame" },
    placement: {
      kind: "wall",
      wallId: "wall-4",
      alongM: 2.5,
      heightM: 1,
      rotationRad: 0,
    },
    sizeM: { width: 2, height: 2, depth: 0.85 },
    locked: false,
  } satisfies Item;
  const camera = {
    positionM: { x: 0, y: 3, z: 6 },
    targetM: { x: 0, y: 1, z: -2.5 },
  };
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  for (const command of [
    { type: "item.add", item },
    { type: "surface.update", surfaceId: "wall-4", color: "#32663a" },
    { type: "camera.set", camera },
  ])
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  const middle = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0, y: 1, z: -2.5 },
  });
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: middle });
      return pixel.green > pixel.red * 1.3 && pixel.green > pixel.blue * 1.2;
    })
    .toBe(true);
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  await page.mouse.click(middle.x, middle.y);
  const toggle = page.getByRole("checkbox", { name: "cut opening in wall" });
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(
    page.getByTestId("item-dimension").filter({ hasText: "0.12 m" }),
  ).toHaveCount(1);
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: middle });
      return pixel.red > 220 && pixel.green > 220 && pixel.blue > 210;
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("opening-material.png") });
  await toggle.uncheck();
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: middle });
      return pixel.green > pixel.red * 1.3;
    })
    .toBe(true);
  await page.getByRole("button", { name: "labelsL", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toggle).toBeChecked();
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 20);
  const gap = projectToScreen({
    camera,
    viewport,
    pointM: { x: -0.5, y: 0.005, z: -2.5 },
  });
  const solid = projectToScreen({
    camera,
    viewport,
    pointM: { x: -1.5, y: 0.005, z: -2.5 },
  });
  await expect
    .poll(async () => (await samplePixel({ page, point: solid })).dark)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await samplePixel({ page, point: gap })).dark)
    .toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("opening-base-lines.png"),
  });
  const saved = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId: project.id }),
  );
  expect(saved.scene.items.find((entry) => entry.id === "door")).toMatchObject({
    cutsOpening: true,
    sizeM: { depth: 0.85 },
  });
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
    { timeout: 15_000 },
  );
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: middle });
      return pixel.red > 220 && pixel.green > 220 && pixel.blue > 210;
    })
    .toBe(true);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: "door",
      patch: {
        name: "Window",
        sizeM: { width: 1, height: 1, depth: 0.85 },
        placement: { ...item.placement, heightM: 2 },
      },
    },
  });
  const windowMiddle = projectToScreen({
    camera,
    viewport,
    pointM: { x: 0, y: 2, z: -2.5 },
  });
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: windowMiddle });
      return pixel.red > 220 && pixel.green > 220 && pixel.blue > 210;
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const pixel = await samplePixel({ page, point: middle });
      return pixel.green > pixel.red * 1.3;
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("raised-window.png") });
});
