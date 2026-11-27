import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { mockGeneration } from "./mock-generation.ts";

declare global {
  interface Window {
    plannerWebglContexts: (WebGLRenderingContext | WebGL2RenderingContext)[];
    plannerClosedBitmaps: number;
    plannerPressureContexts: WebGL2RenderingContext[];
    plannerResumeFrames?: () => void;
  }
}

const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a16-evidence";

function assetMessages(options: { count: number }): ChatMessage[] {
  return [
    {
      id: "previews",
      author: { kind: "agent", role: "modeler" },
      status: "done",
      createdAt: "2026-11-23T00:00:00Z",
      blocks: Array.from({ length: options.count }, (_, index) => ({
        kind: "asset",
        assetId: `preview-${index}`,
        name: `Model ${index + 1}`,
        sizeM: { width: 0.34, height: 0.49, depth: 0.02 },
      })),
    },
  ];
}

async function trackContexts(page: Page) {
  await page.addInitScript(() => {
    window.plannerWebglContexts = [];
    window.plannerClosedBitmaps = 0;
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      window.plannerClosedBitmaps++;
      close.call(this);
    };
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (
        this: HTMLCanvasElement,
        kind: string,
        options?: unknown,
      ) {
        const context: unknown = Reflect.apply(original, this, [kind, options]);
        if (
          (context instanceof WebGLRenderingContext ||
            context instanceof WebGL2RenderingContext) &&
          !window.plannerWebglContexts.includes(context)
        )
          window.plannerWebglContexts.push(context);
        return context;
      },
      configurable: true,
      writable: true,
    });
  });
}

async function roomPixels(page: Page) {
  const png = await page.getByTestId("scene").locator("canvas").screenshot({
    style: "[data-chrome] { visibility: hidden !important; }",
  });
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
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      if (r > 100 && r > g * 1.5 && g > b * 1.3) orange++;
      if (r < 30 && g < 30 && b < 30) dark++;
    }
    return { orange, dark };
  }, png.toString("base64"));
}

test("30 chat assets share one hover context and the scene recovers its pixels after context loss", async ({
  page,
}) => {
  await trackContexts(page);
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    if (/too many active webgl contexts/i.test(message.text()))
      warnings.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await mockGeneration({
    page,
    count: 1,
    messages: assetMessages({ count: 30 }),
    textured: true,
  });
  let modelRequests = 0;
  await page.route("**/assets/preview-29/model.glb", async (route) => {
    modelRequests++;
    await route.fallback();
  });
  fixture.ready(0);
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  await expect(page.getByTestId("item-tag")).not.toHaveAttribute(
    "data-generation-stage",
  );
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const previews = page.getByRole("button", {
    name: "Model preview · hover or focus to turn",
  });
  await expect(previews).toHaveCount(30);
  await expect(
    page.getByText("0.34 × 0.49 × 0.02 m", { exact: true }),
  ).toHaveCount(30);
  await expect
    .poll(() => page.evaluate(() => window.plannerWebglContexts.length))
    .toBe(1);
  await expect
    .poll(async () => (await roomPixels(page)).orange)
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await roomPixels(page)).dark)
    .toBeGreaterThan(5000);
  await previews.last().hover();
  const canvas = previews.last().locator("canvas");
  await expect(canvas).toBeVisible();
  await previews.last().click();
  await expect
    .poll(() => page.evaluate(() => window.plannerWebglContexts.length))
    .toBe(2);
  const still = await canvas.screenshot();
  await expect
    .poll(async () => Buffer.compare(still, await canvas.screenshot()))
    .not.toBe(0);
  expect(modelRequests).toBe(1);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "chat-30-assets-hover.png") });
  for (const index of [28, 15, 0]) {
    await previews.nth(index).hover();
    await expect(previews.nth(index).locator("canvas")).toBeVisible();
    expect(await page.evaluate(() => window.plannerWebglContexts.length)).toBe(
      2,
    );
    await expect(page.locator("canvas")).toHaveCount(2);
  }
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.hover();
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.plannerClosedBitmaps))
    .toBeGreaterThanOrEqual(4);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByTestId("chat-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await previews.last().focus();
  await expect(previews.last().locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => window.plannerWebglContexts.length)).toBe(2);
  await input.focus();
  await expect(page.locator("canvas")).toHaveCount(1);
  await page
    .getByTestId("scene")
    .locator("canvas")
    .evaluate((node) => {
      if (!(node instanceof HTMLCanvasElement))
        throw new Error("Scene canvas unavailable");
      const gl = node.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("Context loss extension unavailable");
      node.addEventListener(
        "webglcontextrestored",
        () => {
          node.setAttribute("data-context-restored", "true");
        },
        { once: true },
      );
      const requestFrame = window.requestAnimationFrame.bind(window);
      const pendingFrames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = function holdFrame(callback) {
        pendingFrames.push(callback);
        return pendingFrames.length;
      };
      window.plannerResumeFrames = function resumeFrames() {
        window.requestAnimationFrame = requestFrame;
        for (const callback of pendingFrames) requestFrame(callback);
        delete window.plannerResumeFrames;
      };
      extension.loseContext();
    });
  try {
    await expect(
      page.getByText("restoring view…", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("scene").locator("canvas")).toHaveAttribute(
      "data-context-restored",
      "true",
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.plannerWebglContexts.at(0)?.isContextLost()),
      )
      .toBe(false);
    await expect(
      page.getByText("restoring view…", { exact: true }),
    ).toBeVisible();
  } finally {
    await page.evaluate(() => window.plannerResumeFrames?.());
  }
  await expect(page.getByText("restoring view…", { exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.plannerWebglContexts.at(0)?.isContextLost()),
    )
    .toBe(false);
  await expect
    .poll(async () => (await roomPixels(page)).orange)
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await roomPixels(page)).dark)
    .toBeGreaterThan(5000);
  expect(await page.evaluate(() => window.plannerWebglContexts.length)).toBe(2);
  await page.screenshot({ path: join(evidence, "scene-restored.png") });
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

test("reduced motion keeps thumbnails still and failed hover loads keep the thumbnail", async ({
  page,
}) => {
  await trackContexts(page);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "warning" &&
      message.text().includes("Model preview unavailable")
    )
      warnings.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockGeneration({
    page,
    count: 1,
    messages: assetMessages({ count: 2 }),
  });
  await page.goto(`/projects/${fixture.projectId}`);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const preview = page
    .getByRole("button", { name: "Model preview · hover or focus to turn" })
    .last();
  await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 256);
  await preview.hover();
  await page.waitForTimeout(200);
  await expect(preview.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => window.plannerWebglContexts.length)).toBe(1);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/assets/preview-1/model.glb", (route) =>
    route.fulfill({ status: 404 }),
  );
  await preview.focus();
  await expect
    .poll(() => page.evaluate(() => window.plannerWebglContexts.length))
    .toBe(2);
  await expect(preview.locator("canvas")).toHaveCount(0);
  await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 256);
  await expect.poll(() => warnings.length).toBe(1);
  expect(warnings.at(0)).toContain("Preview load failed: 404");
});

test("a missing thumbnail shows preview unavailable and can still turn the model", async ({
  page,
}) => {
  const fixture = await mockGeneration({
    page,
    count: 1,
    messages: assetMessages({ count: 1 }),
  });
  await page.route("**/assets/preview-0/thumb.png", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto(`/projects/${fixture.projectId}`);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const preview = page.getByRole("button", {
    name: "Model preview · hover or focus to turn",
  });
  await expect(
    preview.getByText("preview unavailable", { exact: true }),
  ).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  await preview.hover();
  await expect(preview.locator("canvas")).toBeVisible();
});

test("scene comes back after Chrome context eviction", async ({ page }) => {
  await trackContexts(page);
  const fixture = await mockGeneration({ page, count: 1, textured: true });
  fixture.ready(0);
  await page.goto(`/projects/${fixture.projectId}`);
  await expect
    .poll(async () => (await roomPixels(page)).orange)
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await roomPixels(page)).dark)
    .toBeGreaterThan(5000);
  try {
    await page
      .getByTestId("scene")
      .locator("canvas")
      .evaluate((node) => {
        node.setAttribute("data-evicted-canvas", "true");
        window.plannerPressureContexts = Array.from({ length: 17 }, () =>
          document.createElement("canvas").getContext("webgl2"),
        ).filter((context) => context !== null);
      });
    expect(
      await page.evaluate(() => window.plannerPressureContexts.length),
    ).toBe(17);
    await expect
      .poll(() =>
        page.evaluate(() => window.plannerWebglContexts.at(0)?.isContextLost()),
      )
      .toBe(true);
    await expect(
      page.getByText("restoring view…", { exact: true }),
    ).toBeVisible();
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, "scene-context-evicted.png"),
    });
    await expect(
      page.getByText("restoring view…", { exact: true }),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => (await roomPixels(page)).orange)
      .toBeGreaterThan(100);
    await expect
      .poll(async () => (await roomPixels(page)).dark)
      .toBeGreaterThan(5000);
    await page.screenshot({
      path: join(evidence, "scene-context-pressure-restored.png"),
    });
  } finally {
    await page.evaluate(() => {
      for (const context of window.plannerPressureContexts ?? [])
        context.getExtension("WEBGL_lose_context")?.loseContext();
      window.plannerPressureContexts = [];
    });
  }
});

test("scene remounts when the context restored event never arrives", async ({
  page,
}) => {
  const fixture = await mockGeneration({ page, count: 1, textured: true });
  fixture.ready(0);
  const modelLoaded = page.waitForResponse("**/assets/fixture-model/model.glb");
  await page.goto(`/projects/${fixture.projectId}`);
  await (await modelLoaded).finished();
  await expect
    .poll(async () => (await roomPixels(page)).orange)
    .toBeGreaterThan(100);
  await page
    .getByTestId("scene")
    .locator("canvas")
    .evaluate((node) => {
      if (!(node instanceof HTMLCanvasElement))
        throw new Error("Scene canvas unavailable");
      node.setAttribute("data-unrestored-canvas", "true");
      node.addEventListener(
        "webglcontextrestored",
        (event) => event.stopImmediatePropagation(),
        { capture: true },
      );
      const extension = node
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("Context loss extension unavailable");
      extension.loseContext();
    });
  await expect(
    page.getByText("restoring view…", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas[data-unrestored-canvas]")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByText("restoring view…", { exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(async () => (await roomPixels(page)).orange)
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await roomPixels(page)).dark)
    .toBeGreaterThan(5000);
  await page.screenshot({
    path: join(evidence, "scene-context-remounted.png"),
  });
});

test("switching previews aborts the previous download and leaves the new preview running", async ({
  page,
}) => {
  await trackContexts(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (typeof input === "string" && input.endsWith("/preview-0/model.glb"))
        init?.signal?.addEventListener(
          "abort",
          () => {
            document.documentElement.setAttribute(
              "data-preview-aborted",
              "true",
            );
          },
          { once: true },
        );
      return original(input, init);
    };
  });
  const fixture = await mockGeneration({
    page,
    count: 1,
    messages: assetMessages({ count: 2 }),
  });
  const response = Promise.withResolvers<void>();
  let isRequested = false;
  await page.route("**/assets/preview-0/model.glb", async (route) => {
    isRequested = true;
    await response.promise;
    await route.fallback();
  });
  try {
    await page.goto(`/projects/${fixture.projectId}`);
    await page.getByRole("button", { name: "chat", exact: true }).click();
    const previews = page.getByRole("button", {
      name: "Model preview · hover or focus to turn",
    });
    await previews.first().hover();
    await expect.poll(() => isRequested).toBe(true);
    await previews.last().hover();
    await expect(page.locator("html")).toHaveAttribute(
      "data-preview-aborted",
      "true",
    );
    await expect(previews.last().locator("canvas")).toBeVisible();
    await expect(previews.first().locator("canvas")).toHaveCount(0);
    response.resolve();
    await expect(previews.last().locator("canvas")).toBeVisible();
    expect(await page.evaluate(() => window.plannerWebglContexts.length)).toBe(
      2,
    );
  } finally {
    response.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("only missing-requirement notices link to Settings", async ({ page }) => {
  const message: ChatMessage = {
    id: "notices",
    author: { kind: "agent", role: "designer" },
    status: "done",
    createdAt: "2026-11-23T00:00:00Z",
    blocks: [
      { kind: "notice", text: "Modelling failed.", detail: { kind: "error" } },
      {
        kind: "notice",
        text: "Usage limit reached.",
        detail: { kind: "usage-limit", resetAt: "2026-11-23T12:00:00Z" },
      },
      {
        kind: "notice",
        text: "Blender is required.",
        detail: { kind: "missing-requirement", settingsSection: "blender" },
      },
    ],
  };
  const fixture = await mockGeneration({ page, count: 1, messages: [message] });
  await page.goto(`/projects/${fixture.projectId}`);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const notices = page.getByTestId("chat-panel").locator("output");
  await expect(notices).toHaveCount(3);
  await expect(notices.nth(0).getByRole("link")).toHaveCount(0);
  await expect(notices.nth(1).getByRole("link")).toHaveCount(0);
  await expect(notices.nth(1)).toContainText("resets");
  await expect(
    notices.nth(2).getByRole("link", { name: "Settings" }),
  ).toHaveAttribute("href", `/settings?from=${fixture.projectId}#blender`);
});
