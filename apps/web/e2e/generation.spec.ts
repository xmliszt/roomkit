import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { mockGeneration } from "./mock-generation.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a8-evidence";
mkdirSync(evidence, { recursive: true });

async function openGenerationProject(options: {
  page: Page;
  fixture: Awaited<ReturnType<typeof mockGeneration>>;
}) {
  await options.page.goto(`/projects/${options.fixture.projectId}`);
  await expect(options.page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(options.fixture.camera),
  );
}

for (const resource of ["points.bin", "lines.bin", "model.glb"]) {
  test(`keeps the generating cloud while ${resource} loads`, async ({
    page,
  }) => {
    const fixture = await mockGeneration({ page, count: 1 });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route(`**/assets/fixture-model/${resource}`, async (route) => {
      requested = true;
      await blocked;
      await route.fallback();
    });
    try {
      await openGenerationProject({ page, fixture });
      await expect(page.getByTestId("item-tag").first()).toBeAttached();
      await page.keyboard.press("l");
      await expect(page.getByTestId("item-tag")).toBeVisible();
      fixture.stage({ index: 0, stage: "generating" });
      await expect(page.getByTestId("item-tag")).toContainText("generating");
      fixture.ready(0);
      await expect.poll(() => requested).toBe(true);
      await page.waitForTimeout(300);
      expect((await pixels(page)).blue).toBeGreaterThan(100);
      release();
      await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
        "data-generation-stage",
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
    } finally {
      release();
    }
  });
}

test("appearance loads trace lines once and finishes with the textured model", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  let traceRequests = 0;
  await page.route("**/assets/fixture-model/lines.bin", async (route) => {
    traceRequests++;
    await route.fallback();
  });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toBeVisible();
  const modelLoaded = page.waitForResponse("**/assets/fixture-model/model.glb");
  fixture.ready(0);
  await (await modelLoaded).finished();
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  await page.waitForTimeout(300);
  expect(traceRequests).toBe(1);
  expect((await pixels(page)).orange).toBeGreaterThan(500);
  await page.screenshot({ path: join(evidence, "appearance-complete.png") });
});

async function pixels(page: Page) {
  const png = await page
    .locator("canvas")
    .first()
    .screenshot({ style: "[data-chrome] { visibility: hidden !important; }" });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
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
    let checksum = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > g * 1.5 && g > b * 1.3 && r > 100) orange++;
      if (b > r * 1.3 && b > g * 1.2 && b > 80) blue++;
      checksum = Math.imul(checksum ^ r, 16777619);
      checksum = Math.imul(checksum ^ g, 16777619);
      checksum = Math.imul(checksum ^ b, 16777619);
    }
    return { orange, blue, checksum };
  }, png.toString("base64"));
}

test("queued, generating and ready render real pixels, remove all points and do not replay after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · queued");
  fixture.stage({ index: 0, stage: "generating" });
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · generating");
  expect((await pixels(page)).blue).toBeGreaterThan(20);
  await page.screenshot({ path: join(evidence, "ready-0-generating.png") });
  fixture.ready(0);
  for (let frame = 1; frame <= 5; frame++) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(evidence, `ready-${frame}.png`) });
  }
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  const result = await pixels(page);
  expect(result.orange).toBeGreaterThan(500);
  expect(result.blue).toBeLessThan(10);
  await page.screenshot({ path: join(evidence, "ready-6-complete.png") });
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /fixture-model/,
  );
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  await expect
    .poll(async () => (await pixels(page)).orange)
    .toBeGreaterThan(500);
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .toBe(result.checksum);
  expect(errors).toEqual([]);
});

test("only three items animate and a freed slot starts the fourth", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await mockGeneration({ page, count: 4 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toHaveCount(4);
  for (let index = 0; index < 4; index++)
    fixture.stage({ index, stage: "generating" });
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "generating" }),
  ).toHaveCount(3);
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 4 · queued" }),
  ).toBeVisible();
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    if (!gl) return "unavailable";
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return String(
      gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    );
  });
  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        let previous = performance.now();
        function frame(now: number) {
          times.push(now - previous);
          previous = now;
          if (times.length < 121) requestAnimationFrame(frame);
          else resolve(times.slice(1));
        }
        requestAnimationFrame(frame);
      }),
  );
  const sorted = frames.toSorted((a, b) => a - b);
  writeFileSync(
    join(evidence, "three-generating-frame-times.json"),
    JSON.stringify(
      {
        count: 3,
        renderer,
        pointsPerItem: 5000,
        medianMs: sorted.at(Math.floor(sorted.length / 2)),
        p95Ms: sorted.at(Math.floor(sorted.length * 0.95)),
        frames,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: join(evidence, "three-generating.png") });
  fixture.ready(0);
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 4 · generating" }),
  ).toBeVisible({ timeout: 15_000 });
  fixture.stage({ index: 1, stage: "failed" });
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "failed" }),
  ).toHaveClass(/text-danger/);
});

test("reduced motion has no points and crossfades to the model", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toBeVisible();
  fixture.stage({ index: 0, stage: "generating" });
  await expect(page.getByTestId("item-tag")).toContainText("generating");
  const generatingPixels = await pixels(page);
  await page.waitForTimeout(250);
  expect((await pixels(page)).checksum).toBe(generatingPixels.checksum);
  const modelLoaded = page.waitForResponse((response) =>
    response.url().endsWith("/assets/fixture-model/model.glb"),
  );
  fixture.ready(0);
  await modelLoaded;
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 2000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  expect(await pixels(page)).toMatchObject({ blue: 0 });
  expect((await pixels(page)).orange).toBeGreaterThan(500);
  await page.screenshot({ path: join(evidence, "reduced-motion.png") });
});

test("a held item cannot interrupt a model that is already appearing", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 4 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toHaveCount(4);
  for (const index of [1, 2, 3]) fixture.stage({ index, stage: "generating" });
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "generating" }),
  ).toHaveCount(3);
  fixture.ready(3);
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 4 · ready" }),
  ).toBeVisible();
  fixture.stage({ index: 0, stage: "generating" });
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 1 · queued" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 4 · ready" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "Chair 1 · generating" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByTestId("item-tag").filter({ hasText: "chair 4" }),
  ).not.toHaveAttribute("data-generation-stage", { timeout: 15_000 });
});

test("missing sidecars leave the finished asset visible and release its animation slot", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1, sidecars: "missing" });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toBeVisible();
  fixture.ready(0);
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  await expect
    .poll(async () => (await pixels(page)).orange)
    .toBeGreaterThan(500);
});

test("job chat block follows live progress and collapses when done; asset place adds an item", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  fixture.stage({ index: 0, stage: "generating", progress: 0.4 });
  const job = page.locator('details[data-job-id="job-0"]');
  await expect(job).toHaveAttribute("open", "");
  await expect(job.getByRole("progressbar")).toHaveAttribute("value", "0.4");
  await expect(job).toContainText("Preparing mesh");
  fixture.ready(0);
  await expect(job).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "place", exact: true }).click();
  await expect
    .poll(() => JSON.stringify(fixture.sentCommands))
    .toContain('"type":"item.add"');
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /Orange chair/,
  );
});

test("inspector starts a held item, retries failure and keeps an alternative", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  fixture.stage({ index: 0, stage: "held" });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toBeVisible();
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 0, y: 0.6, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.click(point.x, point.y);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector
    .getByRole("button", { name: "model this", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.start",
        projectId: fixture.projectId,
        itemId: "item-0",
      }),
    );
  await expect(page.getByTestId("item-tag")).toContainText("generating");
  fixture.stage({ index: 0, stage: "failed" });
  await expect(page.getByTestId("item-tag")).toContainText("failed");
  await inspector.getByRole("button", { name: "retry", exact: true }).click();
  await expect(page.getByTestId("item-tag")).toContainText("generating");
  fixture.ready(0);
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  fixture.stage({ index: 0, stage: "failed" });
  await expect(
    inspector.getByText("regeneration failed", { exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "retry", exact: true }),
  ).toHaveCount(0);
  await inspector
    .getByRole("button", { name: "try another version", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.alternatives",
        projectId: fixture.projectId,
        itemId: "item-0",
      }),
    );
  await expect(inspector.getByText("creating versions…")).toBeVisible();
  fixture.finishAlternatives();
  await expect(
    inspector
      .getByRole("button", { name: "Model preview · hover or focus to turn" })
      .first(),
  ).toHaveCSS("width", "96px");
  await expect(
    inspector.getByText("height: 0.49 m · estimate: 0.67 m").first(),
  ).toBeVisible();
  expect(
    await inspector.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await inspector
    .getByRole("button", { name: "keep trellis2 chair", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "scene.apply",
        command: {
          type: "item.update",
          itemId: "item-0",
          patch: {
            model: { kind: "asset", assetId: "fixture-trellis2" },
            sizeM: { width: 1.4, height: 1.1, depth: 0.8 },
          },
        },
      }),
    );
  await expect(inspector.getByText("model ready")).toBeVisible();
  await expect(inspector.getByLabel("width", { exact: true })).toHaveValue(
    "1.40",
  );
  await page.screenshot({ path: join(evidence, "inspector-alternatives.png") });
});

test("keeping an opening alternative preserves stored dimensions and its inspector clears the flag", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(fixture.camera),
  );
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 0, y: 0.6, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(async () => {
    await page.mouse.click(point.x, point.y);
    await expect(inspector.getByLabel("width", { exact: true })).toBeVisible({
      timeout: 500,
    });
  }).toPass({ timeout: 15_000 });
  const sizeM = { width: 1.2, height: 2.1, depth: 0.85 };
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: {
        cutsOpening: true,
        sizeM,
        placement: {
          kind: "wall",
          wallId: "wall-4",
          alongM: 3,
          heightM: 1.05,
          rotationRad: 0,
        },
      },
    },
  });
  await expect(inspector.getByText("depth · in wall")).toBeVisible();
  await expect(
    inspector.getByRole("status").filter({ hasText: /^0\.12m$/ }),
  ).toHaveText("0.12m");
  fixture.startAlternatives({ itemId: "item-0" });
  fixture.finishAlternatives();
  await inspector
    .getByRole("button", { name: "keep trellis2 chair", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "scene.apply",
        command: {
          type: "item.update",
          itemId: "item-0",
          patch: { model: { kind: "asset", assetId: "fixture-trellis2" } },
        },
      }),
    );
  await expect
    .poll(() => page.getByTestId("scene").getAttribute("data-items"))
    .toContain(JSON.stringify(sizeM));
  await inspector.getByLabel("cut opening in wall").uncheck();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "scene.apply",
        command: {
          type: "item.update",
          itemId: "item-0",
          patch: { cutsOpening: null },
        },
      }),
    );
  await expect(inspector.getByLabel("depth", { exact: true })).toHaveValue(
    "0.85",
  );
  await page.getByRole("button", { name: "labelsL", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(inspector.getByLabel("cut opening in wall")).toBeChecked();
  await expect(
    inspector.getByRole("status").filter({ hasText: /^0\.12m$/ }),
  ).toHaveText("0.12m");
});

test("keeping a version of a pending item survives the original job failure and reload", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toBeVisible();
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 0, y: 0.6, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "mirror", exact: true }).click();
  fixture.startAlternatives({ itemId: "item-0" });
  fixture.finishAlternatives();
  await page
    .getByRole("button", { name: "keep trellis2 chair", exact: true })
    .click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /"mirrored":true/,
  );
  fixture.stage({ index: 0, stage: "failed" });
  await expect(
    page.getByRole("button", { name: "try another version", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "retry", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
  await expect
    .poll(async () => (await pixels(page)).orange, { timeout: 15_000 })
    .toBeGreaterThan(500);
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /Chair 1/,
  );
  await expect
    .poll(async () => (await pixels(page)).orange, { timeout: 15_000 })
    .toBeGreaterThan(500);
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-items",
    /"mirrored":true/,
  );
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("button", { name: "try another version", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "retry", exact: true }),
  ).toHaveCount(0);
});

for (const notes of ["The legs are oval", ""]) {
  test(`inspector regenerates directly with ${notes ? "corrections" : "empty notes"}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await mockGeneration({ page, count: 1 });
    await openGenerationProject({ page, fixture });
    await expect(page.getByTestId("item-tag")).toBeAttached();
    fixture.ready(0);
    await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
      "data-generation-stage",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    const point = projectToScreen({
      camera: fixture.camera,
      pointM: { x: 0, y: 0.5, z: -1 },
      viewport: { width: 1440, height: 900 },
    });
    await page.mouse.click(point.x, point.y);
    const inspector = page.getByTestId("inspector-body");
    const trigger = inspector
      .locator("button[aria-expanded]")
      .filter({ hasText: /^regenerate$/ });
    await trigger.click();
    const field = inspector.getByLabel("what should change?");
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("maxlength", "1000");
    await field.fill(notes);
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(field).toHaveValue(notes);
    await page.screenshot({
      path: join(evidence, `regenerate-${notes ? "notes" : "empty"}.png`),
    });
    await field.press("Control+Enter");
    await expect
      .poll(() => fixture.sentCommands)
      .toContainEqual(
        expect.objectContaining({
          type: "generation.regenerate",
          projectId: fixture.projectId,
          itemId: "item-0",
          notes,
        }),
      );
    expect(fixture.sentCommands).not.toContainEqual(
      expect.objectContaining({ type: "chat.send" }),
    );
    await expect(
      inspector.getByText("generating…", { exact: true }),
    ).toBeVisible();
    await expect(trigger).toHaveCount(0);
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    await page.reload();
    await expect(page.getByTestId("scene")).toHaveAttribute(
      "data-items",
      /Chair 1/,
    );
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    await page.mouse.click(point.x, point.y);
    await expect(
      inspector.getByText("generating…", { exact: true }),
    ).toBeVisible();
  });
}

for (const outcome of ["cancelled", "failed"]) {
  test(`an asset keeps ready actions after regeneration is ${outcome} and after reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await mockGeneration({
      page,
      count: 1,
      regenerationStage: "queued",
    });
    await openGenerationProject({ page, fixture });
    await expect(page.getByTestId("item-tag")).toBeAttached();
    fixture.ready(0);
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    const point = projectToScreen({
      camera: fixture.camera,
      pointM: { x: 0, y: 0.5, z: -1 },
      viewport: { width: 1440, height: 900 },
    });
    await page.mouse.click(point.x, point.y);
    const inspector = page.getByTestId("inspector-body");
    const trigger = inspector
      .locator("button[aria-expanded]")
      .filter({ hasText: /^regenerate$/ });
    await trigger.click();
    await inspector.getByLabel("what should change?").fill("Oval legs");
    await inspector.getByLabel("what should change?").press("Control+Enter");
    await expect(
      inspector.getByRole("button", { name: /^Cancel / }),
    ).toBeVisible();
    if (outcome === "cancelled") {
      await inspector.getByRole("button", { name: /^Cancel / }).click();
      expect(fixture.sentCommands).toContainEqual(
        expect.objectContaining({
          type: "job.cancel",
          projectId: fixture.projectId,
          jobId: "regeneration-1",
        }),
      );
    } else fixture.stage({ index: 1, stage: "failed" });
    const status = `regeneration ${outcome === "cancelled" ? "held" : "failed"}`;
    await expect(inspector.getByRole("status")).toHaveText(status);
    await trigger.click();
    await expect(inspector.getByLabel("what should change?")).toHaveValue("");
    await inspector.getByLabel("what should change?").press("Escape");
    for (const action of ["try another version", "variant", "regenerate"]) {
      await expect(
        inspector.getByRole("button", { name: action, exact: true }),
      ).toBeEnabled();
    }
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    await page.reload();
    await expect
      .poll(async () => (await pixels(page)).orange)
      .toBeGreaterThan(500);
    await page.mouse.click(point.x, point.y);
    await expect(inspector.getByRole("status")).toHaveText(status);
    for (const action of ["try another version", "variant", "regenerate"]) {
      await expect(
        inspector.getByRole("button", { name: action, exact: true }),
      ).toBeEnabled();
    }
  });
}

for (const action of ["color", "shape"]) {
  test(`inspector ${action} sends a designer request and opens the reply`, async ({
    page,
  }) => {
    const fixture = await mockGeneration({ page, count: 1 });
    await openGenerationProject({ page, fixture });
    await expect(page.getByTestId("item-tag").first()).toBeAttached();
    await page.keyboard.press("l");
    await expect(page.getByTestId("item-tag")).toBeVisible();
    fixture.ready(0);
    await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
      "data-generation-stage",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · ready");
    const point = projectToScreen({
      camera: fixture.camera,
      pointM: { x: 0, y: 0.5, z: -1 },
      viewport: { width: 1440, height: 900 },
    });
    await page.mouse.click(point.x, point.y);
    if (action === "shape") {
      await page.getByRole("button", { name: "chat", exact: true }).click();
      await page.getByRole("tab", { name: "Selected", exact: true }).click();
    }
    const inspector = page.getByTestId("inspector-body");
    await inspector
      .getByRole("button", { name: "variant", exact: true })
      .click();
    if (action === "color")
      await inspector.getByLabel("Colour", { exact: true }).fill("#336699");
    else {
      await inspector.getByLabel("Variant type").selectOption("shape");
      await inspector
        .getByLabel("Describe the change")
        .fill("Make the back taller");
    }
    await inspector
      .getByRole("button", { name: "create variant", exact: true })
      .click();
    const text =
      action === "color"
        ? "Make a colour variant of Chair 1 (item item-0) using #336699."
        : "Make a shape variant of Chair 1 (item item-0): Make the back taller";
    await expect
      .poll(() => fixture.sentCommands)
      .toContainEqual(
        expect.objectContaining({
          type: "chat.send",
          projectId: fixture.projectId,
          text,
        }),
      );
    await expect(
      page.getByRole("tab", { name: "Chat", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByTestId("chat-panel")
        .getByText(`I received your request: ${text}`, { exact: true }),
    ).toBeVisible();
    if (action === "shape")
      await page.screenshot({ path: join(evidence, "designer-variant.png") });
  });
}

test("Jobs cancels a queued job, keeps its box held, and the inspector starts it again", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1 });
  await openGenerationProject({ page, fixture });
  await expect(page.getByTestId("item-tag")).toBeAttached();
  await page.keyboard.press("l");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  const row = page.locator('details[data-job-id="job-0"]');
  await row.getByRole("button", { name: /^Cancel / }).click();
  await expect(row).toContainText("held");
  await expect(page.getByTestId("item-tag")).toHaveText("Chair 1 · held");
  expect(fixture.sentCommands).toContainEqual(
    expect.objectContaining({
      type: "job.cancel",
      projectId: fixture.projectId,
      jobId: "job-0",
    }),
  );
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: 0, y: 0.6, z: -1 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "model this", exact: true }).click();
  await expect(page.getByTestId("item-tag")).toContainText("generating");
});
