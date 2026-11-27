import { expect, test } from "@playwright/test";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { mockGeneration } from "../../../e2e/mock-generation.ts";
import { mirrorFixture } from "./mirror-fixture.ts";

const viewport = { width: 1440, height: 900 };

test("mirrored surface points and trace lines appear on the model's flipped side", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(viewport);
  const clockStartMs = Date.UTC(2030, 0, 1);
  await page.clock.install({ time: new Date(clockStartMs) });
  const fixture = await mockGeneration({ page, count: 1 });
  fixture.camera.positionM = { x: 0, y: 1.3, z: 6 };
  fixture.camera.targetM = { x: 0, y: 0.7, z: -1 };
  const asset = mirrorFixture({ isWall: false });
  const resources = new Set<string>();
  await page.route("**/assets/fixture-model/*", async (route) => {
    const file = route.request().url().split("/").at(-1);
    if (file) resources.add(file);
    if (file === "meta.json") {
      await route.fulfill({
        json: {
          id: "fixture-model",
          kind: "generated",
          mount: "floor",
          nativeSizeM: { width: 1, height: 1, depth: 0.4 },
          triangleCount: 24,
          hasColorMask: false,
          provenance: { method: "test", sourcePhotoIds: [] },
        },
      });
      return;
    }
    const body =
      file === "model.glb"
        ? asset.glb
        : file === "points.bin"
          ? asset.points
          : asset.lines;
    await route.fulfill({ contentType: "application/octet-stream", body });
  });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(fixture.camera),
  );
  const select = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: 0, y: 0.7, z: -0.4 },
  });
  await page.mouse.click(select.x, select.y);
  await page.getByRole("button", { name: "mirror", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "mirror", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.clock.pauseAt(new Date(clockStartMs + 60_000));
  fixture.ready(0);
  await page.clock.runFor(100);
  await expect
    .poll(
      () =>
        resources.has("model.glb") &&
        resources.has("points.bin") &&
        resources.has("lines.bin"),
    )
    .toBe(true);
  await page.clock.runFor(800);
  const png = await page.locator("canvas").first().screenshot();
  const orange = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing point pixel context");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const pixels = Array.from(
      { length: data.length / 4 },
      (_, index) => index,
    ).filter((index) => {
      const r = data[index * 4] ?? 0;
      const g = data[index * 4 + 1] ?? 0;
      const b = data[index * 4 + 2] ?? 0;
      return r > g * 1.5 && g > b * 1.3 && r > 100;
    });
    return {
      left: pixels.filter((index) => index % image.width < image.width / 2)
        .length,
      right: pixels.filter((index) => index % image.width > image.width / 2)
        .length,
    };
  }, png.toString("base64"));
  expect(orange.left).toBe(0);
  expect(orange.right).toBeGreaterThan(100);
  await page.screenshot({
    path: testInfo.outputPath("mirrored-surface-points.png"),
  });
  await page.clock.runFor(250);
  const edge = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: 0.5, y: 1, z: -1 },
  });
  const tracePng = await page.locator("canvas").first().screenshot();
  const dark = await page.evaluate(
    async (input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing trace pixel context");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(
        Math.round(input.edge.x) - 3,
        Math.round(input.edge.y) - 3,
        7,
        7,
      ).data;
      return Array.from({ length: data.length / 4 }).filter(
        (_, index) =>
          (data[index * 4] ?? 255) < 180 &&
          (data[index * 4 + 1] ?? 255) < 180 &&
          (data[index * 4 + 2] ?? 255) < 180,
      ).length;
    },
    { base64: tracePng.toString("base64"), edge },
  );
  expect(dark).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("mirrored-trace.png") });
  await page.clock.runFor(2000);
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
  );
});
