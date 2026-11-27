import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { generationFixture } from "./generation-fixture.ts";
import { mockGeneration } from "./mock-generation.ts";

declare global {
  interface Window {
    loadInPointDraws: number;
    firstRenderedCloud: { atMs: number; orangePixels: number } | undefined;
    loadInFrames: {
      atMs: number;
      stages: string[];
      visibleWaitingTags: number;
    }[];
  }
}

const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a19-evidence";
mkdirSync(evidence, { recursive: true });

async function prepare(page: Page) {
  const fixture = await mockGeneration({ page, count: 12 });
  for (let index = 0; index < 12; index++) {
    fixture.ready(index);
    fixture.apply({
      command: {
        type: "item.update",
        itemId: `item-${index}`,
        patch: {
          model: {
            kind: "asset",
            assetId: index % 2 ? "fixture-blue" : "fixture-model",
          },
          sizeM: { width: 0.5, height: 0.65, depth: 0.5 },
          placement: {
            kind: "floor",
            xM: (index % 4) * 1.1 - 1.65,
            zM: Math.floor(index / 4) * 1.2 - 1.2,
            elevationM: 0,
            rotationRad: 0,
          },
        },
      },
    });
  }
  const blue = generationFixture({ color: [0.03, 0.15, 0.8] });
  await page.route(
    `**/projects/${fixture.projectId}/assets/fixture-blue/*`,
    async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").at(-1);
      await route.fulfill({
        contentType:
          file === "meta.json"
            ? "application/json"
            : "application/octet-stream",
        headers: { "access-control-allow-origin": "*" },
        body:
          file === "model.glb"
            ? blue.glb
            : file === "points.bin"
              ? blue.points
              : file === "lines.bin"
                ? blue.lines
                : JSON.stringify({
                    id: "fixture-blue",
                    kind: "generated",
                    mount: "floor",
                    nativeSizeM: { width: 1, height: 1, depth: 1 },
                    triangleCount: 12,
                    hasColorMask: false,
                    provenance: { method: "fixture", sourcePhotoIds: [] },
                  }),
      });
    },
  );
  await page.addInitScript(() => {
    window.loadInFrames = [];
    window.loadInPointDraws = 0;
    window.firstRenderedCloud = undefined;
    localStorage.setItem("planner:floor-grid", "false");
    localStorage.setItem("planner:object-labels", "true");
    const drawArrays = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function draw(
      mode,
      first,
      count,
    ) {
      drawArrays.call(this, mode, first, count);
      if (mode !== this.POINTS || count !== 5000) return;
      window.loadInPointDraws++;
      if (window.firstRenderedCloud) return;
      const pixels = new Uint8Array(
        this.drawingBufferWidth * this.drawingBufferHeight * 4,
      );
      this.readPixels(
        0,
        0,
        this.drawingBufferWidth,
        this.drawingBufferHeight,
        this.RGBA,
        this.UNSIGNED_BYTE,
        pixels,
      );
      let orangePixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index] ?? 0;
        const g = pixels[index + 1] ?? 0;
        const b = pixels[index + 2] ?? 0;
        if (r > g * 1.5 && g > b * 1.3 && r > 100) orangePixels++;
      }
      if (orangePixels > 20)
        window.firstRenderedCloud = { atMs: performance.now(), orangePixels };
    };
    function sample() {
      const stages = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="item-tag"]'),
        (element) => element.dataset.loadInStage ?? "",
      );
      if (stages.length)
        window.loadInFrames.push({
          atMs: performance.now(),
          stages,
          visibleWaitingTags: Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-load-in-stage="loading"], [data-load-in-stage="waiting"]',
            ),
          ).filter((element) => getComputedStyle(element).display !== "none")
            .length,
        });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  return fixture;
}

async function result(page: Page) {
  return page.evaluate(() => ({
    frames: window.loadInFrames,
    pointDraws: window.loadInPointDraws,
    firstRenderedCloud: window.firstRenderedCloud,
    modelReadyAtMs: Math.min(
      ...Array.from(
        document.querySelectorAll<HTMLElement>("[data-model-ready-at]"),
        (element) => Number(element.dataset.modelReadyAt),
      ),
    ),
    downloadedAtMs: performance
      .getEntriesByType("resource")
      .filter(
        (entry): entry is PerformanceResourceTiming =>
          entry instanceof PerformanceResourceTiming,
      )
      .find((entry) => entry.name.endsWith("/model.glb"))?.responseEnd,
  }));
}

test("twelve ready objects assemble without replaying on edits", async ({
  page,
}) => {
  const fixture = await prepare(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/(points|lines)\.bin$/.test(request.url()))
      requests.push(request.url());
  });
  await page.goto(`/projects/${fixture.projectId}`);
  const appearing = page.locator('[data-load-in-stage="appearing"]');
  await expect(appearing.first()).toBeAttached();
  for (let frame = 0; frame < 4; frame++) {
    await page.screenshot({ path: join(evidence, `load-in-${frame}.png`) });
    await page.waitForTimeout(250);
  }
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(12);
  const loaded = await result(page);
  writeFileSync(
    join(evidence, "load-in-timing.json"),
    JSON.stringify(loaded, null, 2),
  );
  const first = loaded.frames.find((frame) =>
    frame.stages.includes("appearing"),
  );
  const final = loaded.frames.find((frame) =>
    frame.stages.every((stage) => stage === "done"),
  );
  expect(loaded.firstRenderedCloud?.orangePixels).toBeGreaterThan(20);
  expect(
    (loaded.firstRenderedCloud?.atMs ?? Infinity) - loaded.modelReadyAtMs,
  ).toBeLessThan(3000);
  expect(first).toBeDefined();
  expect(loaded.frames.some((frame) => frame.stages.includes("waiting"))).toBe(
    true,
  );
  expect(loaded.frames.every((frame) => frame.visibleWaitingTags === 0)).toBe(
    true,
  );
  expect(final).toBeDefined();
  expect((first?.atMs ?? Infinity) - (loaded.modelReadyAtMs ?? 0)).toBeLessThan(
    3000,
  );
  expect((final?.atMs ?? Infinity) - (loaded.modelReadyAtMs ?? 0)).toBeLessThan(
    10000,
  );
  expect(
    Math.max(
      ...loaded.frames.map(
        (frame) => frame.stages.filter((stage) => stage === "appearing").length,
      ),
    ),
  ).toBeLessThanOrEqual(10);
  expect(requests.filter((url) => url.endsWith("points.bin"))).toHaveLength(2);
  expect(requests.filter((url) => url.endsWith("lines.bin"))).toHaveLength(2);
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -0.55, y: 0.325, z: 1.2 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 55, point.y - 15, { steps: 12 });
  await page.mouse.up();
  expect(
    fixture.sentCommands.some(
      (command) =>
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        command.type === "scene.apply" &&
        "command" in command &&
        typeof command.command === "object" &&
        command.command !== null &&
        "type" in command.command &&
        command.command.type === "item.update",
    ),
  ).toBe(true);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeVisible();
  const elevation = inspector.getByLabel("elevation", { exact: true });
  await elevation.fill("0.2");
  await elevation.press("Enter");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(elevation).toHaveValue("0.00");
  await page.waitForTimeout(300);
  expect(
    (await result(page)).frames
      .filter((frame) => frame.atMs > (final?.atMs ?? 0))
      .every((frame) => frame.stages.every((stage) => stage === "done")),
  ).toBe(true);
  writeFileSync(
    join(evidence, "load-in-timing.json"),
    JSON.stringify(loaded, null, 2),
  );
  await page.screenshot({ path: join(evidence, "load-in-final.png") });
  await page.reload();
  await expect(appearing.first()).toBeAttached();
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(12);
});

test("reduced motion fades all ready objects promptly with no point cloud", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await prepare(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/(points|lines)\.bin$/.test(request.url()))
      requests.push(request.url());
  });
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.locator('[data-load-in-stage="done"]')).toHaveCount(12);
  const loaded = await result(page);
  const final = loaded.frames.find((frame) =>
    frame.stages.every((stage) => stage === "done"),
  );
  writeFileSync(
    join(evidence, "load-in-reduced-timing.json"),
    JSON.stringify(loaded, null, 2),
  );
  expect((final?.atMs ?? Infinity) - (loaded.modelReadyAtMs ?? 0)).toBeLessThan(
    3000,
  );
  expect(requests).toEqual([]);
  expect(loaded.pointDraws).toBe(0);
  expect(loaded.firstRenderedCloud).toBeUndefined();
  await page.screenshot({ path: join(evidence, "load-in-reduced.png") });
});

test("selecting a waiting object from chat finishes load-in immediately", async ({
  page,
}) => {
  const fixture = await mockGeneration({
    page,
    count: 1,
    messages: [
      {
        id: "reference",
        author: { kind: "user" },
        status: "done",
        createdAt: "2026-11-23T00:00:00Z",
        blocks: [
          {
            kind: "item",
            itemId: "item-0",
            name: "Chair 1",
            assetId: "fixture-model",
          },
        ],
      },
    ],
  });
  fixture.ready(0);
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: {
        placement: {
          kind: "floor",
          xM: 100,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    },
  });
  await page.goto(`/projects/${fixture.projectId}`);
  const tag = page.getByTestId("item-tag");
  await expect(tag).toHaveAttribute("data-load-in-stage", "waiting");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await page
    .getByRole("article", { name: "Your message" })
    .getByRole("button", { name: "Chair 1", exact: true })
    .click();
  await expect(tag).toHaveAttribute("data-load-in-stage", "done");
  await page.getByRole("tab", { name: "Selected", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Chair 1", exact: true }),
  ).toBeVisible();
});

for (const outcome of ["404", "timeout"] satisfies ("404" | "timeout")[]) {
  test(`load-in shows the existing box for a ${outcome} model`, async ({
    page,
  }) => {
    const fixture = await mockGeneration({ page, count: 1 });
    fixture.ready(0);
    const response = Promise.withResolvers<void>();
    const requested = Promise.withResolvers<void>();
    await page.route(
      `**/projects/${fixture.projectId}/assets/fixture-model/model.glb`,
      async (route) => {
        requested.resolve();
        await response.promise;
        await route.fulfill({
          status: 404,
          body: "Missing model",
          headers: { "access-control-allow-origin": "*" },
        });
      },
    );
    await page.addInitScript(() => {
      localStorage.setItem("planner:object-labels", "false");
      localStorage.setItem("planner:floor-grid", "false");
    });
    try {
      await page.goto(`/projects/${fixture.projectId}`);
      await requested.promise;
      await expect(page.getByTestId("scene")).toHaveAttribute(
        "data-camera",
        JSON.stringify(fixture.camera),
      );
      const tag = page.getByTestId("item-tag");
      await expect(tag).toHaveAttribute("data-load-in-stage", "loading");
      await page.waitForTimeout(400);
      const point = projectToScreen({
        camera: fixture.camera,
        pointM: { x: 0, y: 0.5, z: -1 },
        viewport: { width: 1440, height: 900 },
      });
      const clip = {
        x: Math.floor(point.x - 85),
        y: Math.floor(point.y - 85),
        width: 170,
        height: 170,
      };
      const empty = await page.screenshot({ clip });
      if (outcome === "404") response.resolve();
      await expect(tag).toHaveAttribute("data-load-in-stage", "done", {
        timeout: 17000,
      });
      await expect
        .poll(async () =>
          Buffer.compare(empty, await page.screenshot({ clip })),
        )
        .not.toBe(0);
      await page.screenshot({
        path: join(evidence, `load-in-${outcome}-box.png`),
        clip,
      });
      if (outcome === "404") {
        await page.unroute(
          `**/projects/${fixture.projectId}/assets/fixture-model/model.glb`,
        );
        await page.mouse.click(point.x, point.y);
        await expect(
          page.getByRole("complementary", { name: "Inspector" }),
        ).toBeVisible();
        await page.locator("canvas").first().focus();
        await page.keyboard.press("Delete");
        await expect(tag).toHaveCount(0);
        const reloaded = page.waitForResponse(
          (result) =>
            result.url().endsWith("/model.glb") && result.status() === 200,
        );
        await page.keyboard.press("ControlOrMeta+z");
        await reloaded;
        await expect(tag).toHaveAttribute("data-load-in-stage", "done");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await page.screenshot({
          path: join(evidence, "load-in-recovered-model.png"),
          clip,
        });
      }
    } finally {
      response.resolve();
    }
  });
}
