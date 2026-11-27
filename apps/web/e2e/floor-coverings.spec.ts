import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect as baseExpect, type Page, test } from "@playwright/test";
import { BoxGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { z } from "zod";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { generationFixture } from "./generation-fixture.ts";
import { mockGeneration } from "./mock-generation.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-f4-evidence";
const sizeM = { width: 2, height: 0.01, depth: 1.4 };
const viewport = { width: 1440, height: 900 };
const expect = baseExpect.configure({ timeout: 15_000 });
mkdirSync(evidence, { recursive: true });
test.setTimeout(60_000);

async function floorFixture(options: {
  page: Page;
  positionM?: { x: number; y: number; z: number };
  material?: "tiles" | "planks";
  heightM?: number;
}) {
  const fixture = await mockGeneration({ page: options.page, count: 0 });
  const parts = [
    new BoxGeometry(1, 0.3, 1).translate(0, 0.5, 0),
    new BoxGeometry(1, 0.35, 0.15).translate(0, 0.825, -0.425),
    ...[-0.4, 0.4].flatMap((x) =>
      [-0.4, 0.4].map((z) =>
        new BoxGeometry(0.12, 0.35, 0.12).translate(x, 0.175, z),
      ),
    ),
  ];
  const geometry = mergeGeometries(parts).toNonIndexed();
  for (const part of parts) part.dispose();
  const sofa = generationFixture({ geometry });
  await options.page.route("**/assets/fixture-sofa/model.glb", (route) =>
    route.fulfill({
      contentType: "application/octet-stream",
      body: sofa.glb,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  fixture.apply({
    command: {
      type: "camera.set",
      camera: {
        positionM: options.positionM ?? fixture.camera.positionM,
        targetM: { x: 0, y: 0, z: 0 },
      },
    },
  });
  fixture.apply({
    command: {
      type: "surface.update",
      surfaceId: "floor",
      color: "#00ff00",
      material:
        options.material === "planks"
          ? {
              kind: "planks",
              plankSizeM: { u: 0.2, v: 1 },
              baseColor: "#00ff00",
              roughness: 0.8,
            }
          : {
              kind: "tiles",
              tileSizeM: { u: 0.4, v: 0.4 },
              baseColor: "#00ff00",
              groutWidthM: 0.01,
              groutColor: "#0000ff",
              roughness: 0.8,
            },
    },
  });
  for (const item of [
    {
      id: "rug",
      name: "Rug",
      sizeM: { ...sizeM, height: options.heightM ?? sizeM.height },
      xM: 0,
    },
    {
      id: "sofa",
      name: "Sofa",
      sizeM: { width: 1, height: 0.8, depth: 1.4 },
      xM: 0.5,
    },
  ])
    fixture.apply({
      command: {
        type: "item.add",
        item: {
          id: item.id,
          name: item.name,
          sizeM: item.sizeM,
          model: {
            kind: "asset",
            assetId: item.id === "sofa" ? "fixture-sofa" : "fixture-model",
          },
          ...(item.id === "sofa"
            ? {
                colorAdjust: {
                  kind: "colorize",
                  color: "#336699",
                  strength: 1,
                },
              }
            : {}),
          placement: {
            kind: "floor",
            xM: item.xM,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
          locked: false,
        },
      },
    });
  await options.page.goto(`/projects/${fixture.projectId}`);
  await expect(options.page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /Sofa/,
  );
  await expect(options.page.locator('[data-load-in-stage="done"]')).toHaveCount(
    2,
  );
  await expect
    .poll(async () => (await rugPixels(options.page)).orange, {
      timeout: 15_000,
    })
    .toBeGreaterThan(1000);
  return fixture;
}

async function camera(page: Page) {
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    /positionM/,
  );
  return CameraSchema.parse(
    JSON.parse(
      (await page.getByTestId("scene").getAttribute("data-camera")) ?? "{}",
    ),
  );
}

async function rugPixels(page: Page) {
  const view = await camera(page);
  const samples = Array.from(
    { length: 15 },
    (_, index) => -0.85 + index * 0.05,
  ).flatMap((x) =>
    Array.from({ length: 21 }, (_, index) => -0.5 + index * 0.05).map((z) =>
      projectToScreen({
        camera: view,
        viewport,
        pointM: { x, y: 0.011, z },
      }),
    ),
  );
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(
    async (options) => {
      const image = new Image();
      image.src = `data:image/png;base64,${options.png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No pixel context");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let orange = 0;
      let blue = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        if (r > g * 1.5 && g > b * 1.3 && r > 100) orange++;
        if (b > r * 1.3 && b > g * 1.2 && b > 80) blue++;
      }
      const pixels = options.samples.map((point) => {
        const index =
          (Math.round(point.y) * image.width + Math.round(point.x)) * 4;
        return Array.from(data.slice(index, index + 3));
      });
      return { orange, blue, pixels };
    },
    { png: png.toString("base64"), samples },
  );
}

async function cloudRegions(options: { page: Page; color: "blue" | "orange" }) {
  const view = await camera(options.page);
  const samples = [-0.55, 0.55].flatMap((x) =>
    [-0.4, 0.4].map((z) =>
      Array.from({ length: 7 }, (_, ix) =>
        Array.from({ length: 7 }, (_, iz) =>
          projectToScreen({
            camera: view,
            viewport,
            pointM: {
              x: x - 0.15 + ix * 0.05,
              y: 0.011,
              z: -1 + z - 0.15 + iz * 0.05,
            },
          }),
        ),
      ).flat(),
    ),
  );
  const png = await options.page.locator("canvas").first().screenshot();
  writeFileSync(join(evidence, `rug-cloud-${options.color}.png`), png);
  return options.page.evaluate(
    async (input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No pixel context");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      return input.samples.map(
        (region) =>
          region.filter((point) =>
            [-1, 0, 1].some((dx) =>
              [-1, 0, 1].some((dy) => {
                const index =
                  ((Math.round(point.y) + dy) * image.width +
                    Math.round(point.x) +
                    dx) *
                  4;
                const r = data[index] ?? 0;
                const g = data[index + 1] ?? 0;
                const b = data[index + 2] ?? 0;
                return input.color === "blue"
                  ? b > r * 1.3 && b > g * 1.2 && b > 80
                  : r > g * 1.5 && g > b * 1.3 && r > 100;
              }),
            ),
          ).length,
      );
    },
    { png: png.toString("base64"), samples, color: options.color },
  );
}

for (const material of ["tiles", "planks"] satisfies ("tiles" | "planks")[]) {
  for (const [angle, positionM] of [
    { x: 0, y: 6, z: 6 },
    { x: -5, y: 3, z: 5 },
    { x: -5, y: 2, z: -5 },
  ].entries()) {
    test(`${material}: rug is opaque and stable at camera angle ${angle + 1}`, async ({
      page,
    }) => {
      await floorFixture({ page, positionM, material });
      await page.mouse.move(20, 20);
      await page.waitForTimeout(300);
      const first = await rugPixels(page);
      expect(first.pixels).toHaveLength(315);
      for (const [r = 0, g = 0, b = 0] of first.pixels) {
        expect(r).toBeGreaterThan(100);
        expect(r).toBeGreaterThan(g * 1.5);
        expect(g).toBeGreaterThan(b * 1.3);
      }
      await page.waitForTimeout(200);
      expect((await rugPixels(page)).pixels).toEqual(first.pixels);
      await page.screenshot({
        path: join(evidence, `${material}-angle-${angle + 1}.png`),
      });
    });
  }
}

test("furniture wins overlapping picks and both objects drag with snapping on and off", async ({
  page,
}) => {
  await floorFixture({ page });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const snap = page.getByRole("button", { name: "snapS", exact: true });
  for (const snapping of [true, false]) {
    if ((await snap.getAttribute("aria-pressed")) !== String(snapping))
      await snap.click();
    for (const id of ["sofa", "rug"]) {
      const items = z
        .array(ItemSchema)
        .parse(
          JSON.parse(
            (await page.getByTestId("scene").getAttribute("data-items")) ??
              "[]",
          ),
        );
      const item = items.find((item) => item.id === id);
      if (!item || item.placement.kind !== "floor")
        throw new Error("Missing floor item");
      const placement = item.placement;
      const pointM = {
        x: placement.xM + (id === "rug" ? -0.6 : 0),
        y: id === "rug" ? 0.011 : 0.8,
        z: placement.zM,
      };
      const view = await camera(page);
      const from = projectToScreen({ camera: view, viewport, pointM });
      const to = projectToScreen({
        camera: view,
        viewport,
        pointM: { ...pointM, x: pointM.x + 0.173, z: pointM.z + 0.123 },
      });
      await page.mouse.click(from.x, from.y);
      await expect(
        inspector.getByRole("heading", { name: item.name, exact: true }),
      ).toBeVisible();
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => {
          const moved = z
            .array(ItemSchema)
            .parse(
              JSON.parse(
                (await page.getByTestId("scene").getAttribute("data-items")) ??
                  "[]",
              ),
            )
            .find((item) => item.id === id);
          return moved?.placement;
        })
        .not.toEqual(placement);
      const moved = z
        .array(ItemSchema)
        .parse(
          JSON.parse(
            (await page.getByTestId("scene").getAttribute("data-items")) ??
              "[]",
          ),
        )
        .find((item) => item.id === id);
      if (moved?.placement.kind !== "floor")
        throw new Error("Missing moved floor item");
      const remainder =
        moved.placement.xM / 0.05 - Math.round(moved.placement.xM / 0.05);
      if (snapping) expect(Math.abs(remainder)).toBeLessThan(0.000001);
      else expect(Math.abs(remainder)).toBeGreaterThan(0.01);
    }
  }
});

test("a 3 mm rug hides the floor grid", async ({ page }) => {
  await floorFixture({
    page,
    heightM: 0.003,
    positionM: { x: 0, y: 6, z: 0.001 },
  });
  const pixels = await rugPixels(page);
  for (const [r = 0, g = 0, b = 0] of pixels.pixels) {
    expect(r).toBeGreaterThan(100);
    expect(r).toBeGreaterThan(g * 1.5);
    expect(g).toBeGreaterThan(b * 1.3);
  }
});

for (const positionM of [
  { x: 0, y: 6, z: 0.001 },
  { x: -5, y: 3, z: 0 },
]) {
  test(`a tray on a table over a rug, the table and the exposed rug each select from ${JSON.stringify(positionM)}`, async ({
    page,
  }) => {
    await trayFixtureClicks({ page, positionM });
  });
}

async function trayFixtureClicks(options: {
  page: Page;
  positionM: { x: number; y: number; z: number };
}) {
  const page = options.page;
  const fixture = await floorFixture({ page });
  for (const item of [
    {
      id: "table",
      name: "Table",
      sizeM: { width: 0.6, height: 0.5, depth: 0.6 },
      elevationM: 0,
    },
    {
      id: "tray",
      name: "Tray",
      sizeM: { width: 0.4, height: 0.02, depth: 0.3 },
      elevationM: 0.5,
    },
  ])
    fixture.apply({
      command: {
        type: "item.add",
        item: {
          id: item.id,
          name: item.name,
          sizeM: item.sizeM,
          model: { kind: "asset", assetId: "fixture-model" },
          placement: {
            kind: "floor",
            xM: -0.5,
            zM: 0,
            elevationM: item.elevationM,
            rotationRad: 0,
          },
          locked: false,
        },
      },
    });
  fixture.apply({
    command: {
      type: "camera.set",
      camera: {
        positionM: options.positionM,
        targetM: { x: 0, y: 0, z: 0 },
      },
    },
  });
  await page.reload();
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(4, {
    timeout: 20_000,
  });
  const view = await camera(page);
  for (const target of [
    { name: "Tray", pointM: { x: -0.5, y: 0.52, z: 0 } },
    { name: "Table", pointM: { x: -0.75, y: 0.5, z: 0.25 } },
    { name: "Rug", pointM: { x: -0.9, y: 0.011, z: 0.5 } },
  ]) {
    const point = projectToScreen({
      camera: view,
      viewport,
      pointM: target.pointM,
    });
    await page.mouse.click(point.x, point.y);
    await expect(
      page.getByRole("heading", { name: target.name, exact: true }),
    ).toBeVisible();
  }
}

test("hover moves between the exposed rug and the sofa standing on it", async ({
  page,
}) => {
  const fixture = await floorFixture({ page });
  fixture.apply({
    command: {
      type: "camera.set",
      camera: {
        positionM: { x: -5, y: 0.65, z: 0 },
        targetM: { x: 0, y: 0, z: 0 },
      },
    },
  });
  await page.reload();
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(2, {
    timeout: 20_000,
  });
  const view = await camera(page);
  const visibleTags = page.locator('[data-testid="item-tag"]:visible');
  for (const target of [
    { name: /rug/i, pointM: { x: -0.6, y: 0.011, z: 0 } },
    { name: /sofa/i, pointM: { x: -0.03, y: 0.011, z: 0 } },
    { name: /rug/i, pointM: { x: -0.6, y: 0.011, z: 0 } },
  ]) {
    const point = projectToScreen({
      camera: view,
      viewport,
      pointM: target.pointM,
    });
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await expect(visibleTags).toHaveCount(1);
    await expect(visibleTags).toHaveText(target.name);
  }
});

test("a nearer rug yields selection and dragging to the sofa behind it", async ({
  page,
}) => {
  const fixture = await floorFixture({ page });
  fixture.apply({
    command: {
      type: "camera.set",
      camera: {
        positionM: { x: -5, y: 0.65, z: 0 },
        targetM: { x: 0, y: 0, z: 0 },
      },
    },
  });
  await page.reload();
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(2, {
    timeout: 20_000,
  });
  const view = await camera(page);
  const from = projectToScreen({
    camera: view,
    viewport,
    pointM: { x: -0.03, y: 0.011, z: 0 },
  });
  await page.mouse.click(from.x, from.y);
  await expect(
    page.getByRole("heading", { name: "Sofa", exact: true }),
  ).toBeVisible();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("scene")).not.toHaveAttribute(
    "data-items",
    /"xM":0\.5,"zM":0,/,
  );
});

test("a flat rug generates across its face, appears and keeps a flat alternative", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1, sizeM });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  fixture.stage({ index: 0, stage: "generating", progress: 0.8 });
  await expect
    .poll(async () =>
      (await cloudRegions({ page, color: "blue" })).map((count) => count >= 5),
    )
    .toEqual([true, true, true, true]);
  writeFileSync(
    join(evidence, "rug-generation-regions.json"),
    JSON.stringify(await cloudRegions({ page, color: "blue" })),
  );
  await page.screenshot({ path: join(evidence, "rug-generating.png") });
  fixture.ready(0);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /"height":0\.01/,
  );
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
  );
  await expect
    .poll(async () => (await rugPixels(page)).orange, { timeout: 15_000 })
    .toBeGreaterThan(1000);
  const point = projectToScreen({
    camera: fixture.camera,
    viewport,
    pointM: { x: 0, y: 0.011, z: -1 },
  });
  await page.mouse.click(point.x, point.y);
  fixture.startAlternatives({ itemId: "item-0" });
  fixture.finishAlternatives();
  await page
    .getByRole("button", { name: "keep trellis2 chair", exact: true })
    .click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /fixture-trellis2/,
  );
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /"height":0\.01/,
  );
  await expect
    .poll(async () => (await rugPixels(page)).orange, { timeout: 15_000 })
    .toBeGreaterThan(1000);
  await page.reload();
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await rugPixels(page)).orange, { timeout: 15_000 })
    .toBeGreaterThan(1000);
  await page.screenshot({
    path: join(evidence, "rug-alternative-reloaded.png"),
  });
});

test("a flat rug load-in cloud covers four interior regions before revealing", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1, sizeM });
  fixture.ready(0);
  const model = Promise.withResolvers<void>();
  await page.route("**/assets/fixture-model/model.glb", async (route) => {
    await model.promise;
    await route.fallback();
  });
  await page.clock.install();
  await page.goto(`/projects/${fixture.projectId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    /positionM/,
  );
  await expect(page.locator('[data-load-in-stage="loading"]')).toHaveCount(1);
  await page.clock.pauseAt(Date.now() + 1000);
  model.resolve();
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return page.locator('[data-load-in-stage="appearing"]').count();
    })
    .toBe(1);
  await page.clock.runFor(200);
  await expect
    .poll(async () =>
      (await cloudRegions({ page, color: "orange" })).map(
        (count) => count >= 3,
      ),
    )
    .toEqual([true, true, true, true]);
  writeFileSync(
    join(evidence, "rug-load-in-regions.json"),
    JSON.stringify(await cloudRegions({ page, color: "orange" })),
  );
  await page.screenshot({ path: join(evidence, "rug-load-in-cloud.png") });
  await page.clock.runFor(1400);
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(1);
});
