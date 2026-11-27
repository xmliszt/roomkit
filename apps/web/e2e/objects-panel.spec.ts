import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectsLibraryResult } from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { mockGeneration } from "./mock-generation.ts";

declare global {
  interface Window {
    plannerWebglContexts: (WebGLRenderingContext | WebGL2RenderingContext)[];
  }
}

type LibraryObject = ObjectsLibraryResult["objects"][number];

const viewport = { width: 1440, height: 900 };
const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a12-evidence";
const thumbnail = readFileSync(
  new URL(
    "../../../packages/daemon/catalog/charging-port/thumb.png",
    import.meta.url,
  ),
);

function libraryObject(options: {
  projectId: string;
  assetId: string;
  name: string;
  createdAt?: string;
}): LibraryObject {
  return {
    assetId: options.assetId,
    name: options.name,
    nativeSizeM: { width: 1, height: 1, depth: 1 },
    mount: "floor",
    thumbUrl: `/projects/${options.projectId}/assets/${options.assetId}/thumb.png`,
    origin: "inventory",
    createdAt: options.createdAt ?? "2026-11-23T00:00:00.000Z",
    itemIds: [],
    builtIn: false,
  };
}

async function trackContexts(page: Page) {
  await page.addInitScript(() => {
    window.plannerWebglContexts = [];
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

async function setup(options: {
  page: Page;
  count: number;
  assetIds?: (index: number) => string;
}) {
  await options.page.emulateMedia({ reducedMotion: "reduce" });
  const library: { objects: LibraryObject[]; archived: LibraryObject[] } = {
    objects: [],
    archived: [],
  };
  const fixture = await mockGeneration({
    page: options.page,
    count: options.count,
    handleCommand: (command) => {
      switch (command.type) {
        case "objects.library":
          return { ok: true, result: { objects: library.objects } };
        case "objects.archived":
          return { ok: true, result: { objects: library.archived } };
        case "objects.archive":
        case "objects.restore": {
          const [from, to] =
            command.type === "objects.archive"
              ? [library.objects, library.archived]
              : [library.archived, library.objects];
          const object = from.find(
            (entry) => entry.assetId === command.assetId,
          );
          if (!object) return { ok: false, error: "Model not found" };
          from.splice(from.indexOf(object), 1);
          to.push(object);
          return { ok: true, result: { assetId: command.assetId } };
        }
        case "item.sources":
          return {
            ok: true,
            result: {
              items: [
                {
                  itemId: command.itemId,
                  origin: "inventory",
                  photos: [
                    {
                      kind: "photo",
                      photoId: "photo-a",
                      box: [0.1, 0.2, 0.5, 0.6],
                      isBest: true,
                      cropUrl: `/projects/${command.projectId}/photos/photo-a/crop?box=0.1,0.2,0.5,0.6&size=256`,
                    },
                    {
                      kind: "photo",
                      photoId: "photo-b",
                      box: [0.3, 0.3, 0.7, 0.9],
                      isBest: false,
                      cropUrl: `/projects/${command.projectId}/photos/photo-b/crop?box=0.3,0.3,0.7,0.9&size=256`,
                    },
                  ],
                },
              ],
            },
          };
        default:
          return undefined;
      }
    },
  });
  await options.page.route(
    `**/projects/${fixture.projectId}/photos/**`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: thumbnail,
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  const assetIds = options.assetIds ?? (() => "fixture-model");
  library.objects.push(
    libraryObject({
      projectId: fixture.projectId,
      assetId: "spare-lamp",
      name: "Spare lamp",
      createdAt: "2026-11-22T00:00:00.000Z",
    }),
    {
      assetId: "charging-port",
      name: "Type G",
      nativeSizeM: { width: 0.086, height: 0.086, depth: 0.01 },
      mount: "wall",
      thumbUrl: "/catalog/charging-port/thumb.png",
      origin: "catalog",
      createdAt: "1970-01-01T00:00:00.000Z",
      itemIds: [],
      builtIn: true,
    },
  );
  function ready(index: number) {
    const assetId = assetIds(index);
    if (!library.objects.some((entry) => entry.assetId === assetId))
      library.objects.unshift(
        libraryObject({
          projectId: fixture.projectId,
          assetId,
          name: `Chair ${index + 1}`,
        }),
      );
    fixture.apply({
      command: {
        type: "item.update",
        itemId: `item-${index}`,
        patch: {
          model: { kind: "asset", assetId },
          sizeM: { width: 1, height: 1, depth: 1 },
        },
      },
    });
    fixture.stage({ index, stage: "ready" });
  }
  return { ...fixture, library, ready };
}

async function load(options: {
  page: Page;
  projectId: string;
  camera: object;
}) {
  await options.page.goto(`/projects/${options.projectId}`);
  await expect(options.page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(options.camera),
  );
  await expect(
    options.page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
}

async function openObjects(page: Page) {
  await page.locator("canvas").first().focus();
  await page.keyboard.press("o");
  await expect(page.getByRole("tab", { name: "Objects" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return page.getByRole("region", { name: "Project objects" });
}

async function items(page: Page) {
  return z
    .array(ItemSchema)
    .parse(
      JSON.parse(
        (await page.getByTestId("scene").getAttribute("data-items")) ?? "[]",
      ),
    );
}

function row(options: { page: Page; name: string }) {
  return options.page
    .getByRole("region", { name: "Project objects" })
    .getByRole("article", { name: options.name, exact: true });
}

function rowToggle(options: { page: Page; name: string }) {
  return row(options)
    .locator("button[aria-expanded]")
    .filter({ hasText: options.name });
}

async function expand(options: { page: Page; name: string }) {
  await expect(
    options.page
      .getByRole("region", { name: "Project objects" })
      .getByText("loading models…"),
  ).toHaveCount(0);
  const toggle = rowToggle(options);
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const select = row(options).getByRole("button", {
    name: "Select in room to configure",
  });
  if (await select.count()) await select.click();
}

test("O opens the library with each preview state, the in-room count and no ids", async ({
  page,
}) => {
  const fixture = await setup({
    page,
    count: 5,
    assetIds: (index) => `model-${index}`,
  });
  fixture.ready(0);
  fixture.stage({ index: 1, stage: "generating", progress: 0.4 });
  fixture.stage({ index: 2, stage: "held" });
  fixture.stage({ index: 3, stage: "failed" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  await expect(panel.getByRole("article")).toHaveCount(7);
  const ready = row({ page, name: "Chair 1" });
  await expect(
    ready.getByRole("button", { name: /model preview/i }),
  ).toHaveCount(1);
  await expect(ready).toContainText("ready · 1 in room");
  const generating = row({ page, name: "Chair 2" });
  await expect(generating).toContainText("generating · 40% · 1 in room");
  await expect(
    generating.getByRole("progressbar", { name: "Chair 2 progress" }),
  ).toHaveAttribute("value", "0.4");
  await expect(row({ page, name: "Chair 3" })).toContainText("model this");
  await expect(row({ page, name: "Chair 4" })).toContainText("failed");
  await expect(row({ page, name: "Chair 5" })).toContainText("queued");
  await expect(
    row({ page, name: "Chair 5" }).getByRole("progressbar"),
  ).toBeVisible();
  await expect(row({ page, name: "Spare lamp" })).toContainText(
    "ready · 0 in room",
  );
  await expect(row({ page, name: "Type G" })).toContainText("built-in");
  await rowToggle({ page, name: "Chair 1" }).click();
  await expect(panel).not.toContainText(/model-\d|item-\d|job-\d|photo-a/);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "objects-panel.png") });
});

test("filters and search narrow the list", async ({ page }) => {
  const fixture = await setup({
    page,
    count: 4,
    assetIds: (index) => `model-${index}`,
  });
  fixture.ready(0);
  fixture.stage({ index: 1, stage: "failed" });
  fixture.stage({ index: 2, stage: "held" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  await panel.getByRole("button", { name: "Needs attention" }).click();
  await expect(
    panel
      .getByRole("article")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      ),
  ).resolves.toEqual(["Chair 2", "Chair 3"]);
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await panel.getByRole("searchbox", { name: "Search objects" }).fill("spare");
  await expect(panel.getByRole("article")).toHaveCount(1);
  await expect(row({ page, name: "Spare lamp" })).toBeVisible();
  await panel.getByRole("searchbox", { name: "Search objects" }).fill("zzz");
  await expect(panel.getByText("No matching objects")).toBeVisible();
  await panel.getByRole("searchbox", { name: "Search objects" }).fill("chair");
  await panel.getByRole("button", { name: "Needs attention" }).click();
  await expand({ page, name: "Chair 2" });
  await page.getByRole("tab", { name: "Jobs" }).click();
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(
    panel.getByRole("searchbox", { name: "Search objects" }),
  ).toHaveValue("chair");
  await expect(
    panel.getByRole("button", { name: "Needs attention" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(rowToggle({ page, name: "Chair 2" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("expanding an inventoried object shows its crops and opens one full size with its box", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  await rowToggle({ page, name: "Chair 1" }).click();
  const sources = panel.getByRole("region", { name: "Source photos" });
  const crops = sources.getByRole("button", { name: /Open source photo/ });
  await expect(crops).toHaveCount(2);
  await expect(crops.first()).toHaveAccessibleName(
    "Open source photo 1 · best view",
  );
  await expect(crops.first().getByRole("img")).toHaveAttribute(
    "src",
    /\/photos\/photo-a\/crop\?box=0\.1,0\.2,0\.5,0\.6/,
  );
  await crops.first().click();
  const dialog = page.getByRole("dialog", { name: "Source photo" });
  await expect(dialog.getByRole("img")).toHaveAttribute(
    "src",
    /\/photos\/photo-a$/,
  );
  const box = dialog.getByTestId("source-box");
  await expect(box).toHaveAttribute(
    "style",
    /left: 10%; top: 20%; width: 40%; height: 40%/,
  );
  await page.screenshot({ path: join(evidence, "objects-source-photo.png") });
});

test("row select frames the object and scene select highlights its row", async ({
  page,
}) => {
  const fixture = await setup({
    page,
    count: 2,
    assetIds: (index) => `model-${index}`,
  });
  fixture.ready(0);
  fixture.ready(1);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  await openObjects(page);
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -1, y: 0.5, z: -1 },
    viewport,
  });
  await page.mouse.click(point.x, point.y);
  await expect(row({ page, name: "Chair 1" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(row({ page, name: "Chair 1" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(row({ page, name: "Chair 2" })).toHaveAttribute(
    "data-selected",
    "false",
  );
  const before = await page.getByTestId("scene").getAttribute("data-camera");
  await rowToggle({ page, name: "Chair 2" }).click();
  await expect(row({ page, name: "Chair 2" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(row({ page, name: "Chair 1" })).toHaveAttribute(
    "data-selected",
    "false",
  );
  await expect
    .poll(() => page.getByTestId("scene").getAttribute("data-camera"))
    .not.toBe(before);
  await page.waitForTimeout(500);
  const framed = await page.getByTestId("scene").getAttribute("data-camera");
  await rowToggle({ page, name: "Chair 2" }).click();
  await expect(rowToggle({ page, name: "Chair 2" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.waitForTimeout(500);
  expect(await page.getByTestId("scene").getAttribute("data-camera")).toBe(
    framed,
  );

  const libraryReads = () =>
    fixture.sentCommands.filter(
      (command) =>
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        command.type === "objects.library",
    ).length;
  const reads = libraryReads();
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-1",
      patch: { name: "Desk chair" },
    },
  });
  await expect(row({ page, name: "Desk chair" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(libraryReads()).toBe(reads);
});

test("row actions send the same commands as the context menu", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  await openObjects(page);
  await rowToggle({ page, name: "Chair 1" }).click();
  const chair = row({ page, name: "Chair 1" });
  const original = await items(page);
  for (const action of [
    "duplicate",
    "duplicate mirrored",
    "mirror",
    "lock",
    "delete",
  ]) {
    await expand({ page, name: "Chair 1" });
    await chair
      .getByRole("button", {
        name:
          action === "duplicate"
            ? /^duplicate(?! mirrored)/
            : new RegExp(`^${action}`),
      })
      .click();
    await expect
      .poll(async () => {
        const current = await items(page);
        if (action === "delete") return current.length === 0;
        if (action === "duplicate" || action === "duplicate mirrored")
          return (
            current.length === 2 &&
            (action === "duplicate" || current.at(1)?.mirrored === true)
          );
        return action === "mirror"
          ? current.at(0)?.mirrored === true
          : current.at(0)?.locked === true;
      })
      .toBe(true);
    await page.locator("canvas").first().focus();
    await page.keyboard.press("Meta+z");
    await expect.poll(() => items(page)).toEqual(original);
  }
  await expand({ page, name: "Chair 1" });
  await chair.getByRole("button", { name: "Send to Chat" }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(
    page.getByRole("button", { name: "Remove reference to Chair 1" }),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "Objects" }).click();
  await expand({ page, name: "Chair 1" });
  await chair.getByRole("button", { name: "regenerate", exact: true }).click();
  await chair
    .getByRole("textbox", { name: "what should change?" })
    .fill("Make the legs slimmer");
  await chair
    .getByRole("button", { name: "regenerate", exact: true })
    .last()
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.regenerate",
        itemId: "item-0",
        notes: "Make the legs slimmer",
      }),
    );
  await chair.getByRole("button", { name: "Advanced settings" }).click();
  await expect(page.getByRole("tab", { name: "Selected" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("try another version and variant use their existing commands", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  await openObjects(page);
  await expand({ page, name: "Chair 1" });
  const chair = row({ page, name: "Chair 1" });
  await chair.getByRole("button", { name: "try another version" }).click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "generation.alternatives",
        itemId: "item-0",
      }),
    );
  await chair.getByRole("button", { name: "variant", exact: true }).click();
  await chair.getByRole("button", { name: "create variant" }).click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({
        type: "chat.send",
        text: expect.stringContaining("Make a colour variant of Chair 1"),
      }),
    );
});

test("a held row stays one expanded row when its model arrives, and failed rows retry", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 2 });
  fixture.stage({ index: 0, stage: "held" });
  fixture.stage({ index: 1, stage: "failed" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  await expand({ page, name: "Chair 1" });
  fixture.ready(0);
  await expect(
    panel.getByRole("article", { name: "Chair 1", exact: true }),
  ).toHaveCount(1);
  await expect(
    row({ page, name: "Chair 1" }).getByRole("button", {
      name: /model preview/i,
    }),
  ).toBeVisible();
  await expect(rowToggle({ page, name: "Chair 1" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expand({ page, name: "Chair 2" });
  await row({ page, name: "Chair 2" })
    .getByRole("button", { name: "retry", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({ type: "generation.start", itemId: "item-1" }),
    );
});

test("held and queued rows start and cancel through the generation commands", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 2 });
  fixture.stage({ index: 1, stage: "held" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  await openObjects(page);
  await expand({ page, name: "Chair 1" });
  await row({ page, name: "Chair 1" })
    .getByRole("button", { name: /^Cancel / })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({ type: "job.cancel", jobId: "job-0" }),
    );
  await expand({ page, name: "Chair 2" });
  await row({ page, name: "Chair 2" })
    .getByRole("button", { name: "model this", exact: true })
    .click();
  await expect
    .poll(() => fixture.sentCommands)
    .toContainEqual(
      expect.objectContaining({ type: "generation.start", itemId: "item-1" }),
    );
});

test("an unplaced model offers no steering, places at the view centre with one undo, and is removed and restored", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  const lamp = row({ page, name: "Spare lamp" });
  await expand({ page, name: "Spare lamp" });
  await expect(
    lamp.locator("button:not([aria-expanded]):not([aria-label])"),
  ).toHaveText(["Place in room", "Remove from catalog"]);
  const original = await items(page);
  await lamp.getByRole("button", { name: "Place in room" }).click();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  const placed = (await items(page)).at(1);
  expect(placed?.model).toEqual({ kind: "asset", assetId: "spare-lamp" });
  expect(placed?.placement).toMatchObject({ kind: "floor", elevationM: 0 });
  if (placed?.placement.kind !== "floor") throw new Error("Not on the floor");
  expect(placed.placement.xM).toBeCloseTo(0, 2);
  expect(placed.placement.zM).toBeCloseTo(0, 2);
  await expect(lamp).toContainText("1 in room");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Meta+z");
  await expect.poll(() => items(page)).toEqual(original);
  await expect(lamp).toContainText("0 in room");

  await expand({ page, name: "Spare lamp" });
  await lamp.getByRole("button", { name: "Remove from catalog" }).click();
  await expect(lamp).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Undo" })).toBeFocused();
  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("tab", { name: "Objects" }).click();
  await panel.getByRole("button", { name: "Undo" }).click();
  await expect(lamp).toBeVisible();

  await expand({ page, name: "Spare lamp" });
  await lamp.getByRole("button", { name: "Remove from catalog" }).click();
  await expect(lamp).toHaveCount(0);
  await panel.getByRole("button", { name: "Hidden" }).click();
  await expect(panel.getByRole("article")).toHaveCount(1);
  await rowToggle({ page, name: "Spare lamp" }).click();
  await lamp.getByRole("button", { name: "Restore" }).click();
  await expect(panel.getByText("No hidden models")).toBeVisible();
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await expect(lamp).toBeVisible();
  await expect(lamp).toContainText("0 in room");
});

test("the library reloads when a generation is ready and when the last use of a model is deleted and undone", async ({
  page,
}) => {
  const fixture = await setup({ page, count: 1 });
  fixture.stage({ index: 0, stage: "held" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  const libraryReads = () =>
    fixture.sentCommands.filter(
      (command) =>
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        command.type === "objects.library",
    ).length;
  await expect.poll(libraryReads).toBeGreaterThan(0);
  const beforeReady = libraryReads();
  fixture.ready(0);
  await expect.poll(libraryReads).toBeGreaterThan(beforeReady);
  const chair = row({ page, name: "Chair 1" });
  await expect(chair).toContainText("ready · 1 in room");
  await expect(
    chair.getByRole("button", {
      name: "Chair 1 · model preview · hover or focus to turn",
    }),
  ).toBeVisible();
  await expand({ page, name: "Chair 1" });
  const beforeDelete = libraryReads();
  await chair.getByRole("button", { name: /^delete/ }).click();
  await expect(chair).toContainText("0 in room");
  await expect.poll(libraryReads).toBeGreaterThan(beforeDelete);
  const beforeUndo = libraryReads();
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Meta+z");
  await expect(chair).toContainText("1 in room");
  await expect.poll(libraryReads).toBeGreaterThan(beforeUndo);
  await expect(panel.getByRole("article")).toHaveCount(3);
});

test("30 objects scroll with at most two WebGL contexts", async ({ page }) => {
  await trackContexts(page);
  const fixture = await setup({
    page,
    count: 30,
    assetIds: (index) => `model-${index}`,
  });
  for (let index = 0; index < 30; index++) fixture.ready(index);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  const previews = panel.getByRole("button", { name: /model preview/i });
  await expect(previews).toHaveCount(31);
  await previews.last().scrollIntoViewIfNeeded();
  await previews.last().hover();
  await expect(previews.last().locator("canvas")).toBeVisible();
  for (const index of [29, 15, 0]) {
    await previews.nth(index).scrollIntoViewIfNeeded();
    await previews.nth(index).hover();
    await expect(previews.nth(index).locator("canvas")).toBeVisible();
    expect(
      await page.evaluate(() => window.plannerWebglContexts.length),
    ).toBeLessThanOrEqual(2);
  }
  await previews.first().scrollIntoViewIfNeeded();
  await expect(row({ page, name: "Chair 1" })).not.toBeInViewport();
  const point = projectToScreen({
    camera: fixture.camera,
    pointM: { x: -1, y: 0.5, z: -1 },
    viewport,
  });
  await page.mouse.click(point.x, point.y);
  await expect(row({ page, name: "Chair 1" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(row({ page, name: "Chair 1" })).toBeInViewport();
  await page.screenshot({ path: join(evidence, "objects-30.png") });
});

test("the inspect preview orbits on drag, zooms on wheel, resizes in place and is released on collapse", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await trackContexts(page);
  const modelRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/model.glb")) modelRequests.push(request.url());
  });
  const fixture = await setup({
    page,
    count: 30,
    assetIds: (index) => `model-${index}`,
  });
  for (let index = 0; index < 30; index++) fixture.ready(index);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const panel = await openObjects(page);
  await expand({ page, name: "Spare lamp" });
  const lamp = row({ page, name: "Spare lamp" });
  const inspect = lamp.getByRole("img", {
    name: "Spare lamp · inspect · drag to orbit, scroll to zoom",
  });
  await inspect.scrollIntoViewIfNeeded();
  await expect(inspect.locator("canvas")).toBeVisible();
  const box = await inspect.boundingBox();
  if (!box) throw new Error("Inspect preview has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  async function drag() {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 60, centre.y + 20, { steps: 4 });
    await page.mouse.up();
  }
  const start = await inspect.screenshot();
  await drag();
  const dragged = await inspect.screenshot();
  expect(dragged.equals(start)).toBe(false);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(async () => (await inspect.screenshot()).equals(dragged))
    .toBe(false);
  expect((await inspect.boundingBox())?.y).toBe(box.y);
  await page.screenshot({ path: join(evidence, "objects-inspect.png") });

  const thumbnail = lamp.getByRole("button", { name: /model preview/ });
  await thumbnail.hover();
  await expect(inspect.locator("canvas")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(0, 0);
  await thumbnail.hover();
  await expect(thumbnail.locator("canvas")).toBeVisible();
  await expect(inspect.locator("canvas")).toHaveCount(0);
  await inspect.hover();
  await expect(inspect.locator("canvas")).toBeVisible();
  await expect(thumbnail.locator("canvas")).toHaveCount(0);
  const returned = await inspect.screenshot();
  await drag();
  expect((await inspect.screenshot()).equals(returned)).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await rowToggle({ page, name: "Spare lamp" }).click();
  await expect(inspect).toHaveCount(0);
  await expect(panel.locator("canvas")).toHaveCount(0);
  const lampTop = (await lamp.boundingBox())?.y ?? 0;
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(async () => (await lamp.boundingBox())?.y ?? 0)
    .toBeGreaterThan(lampTop);

  await expand({ page, name: "Chair 1" });
  const chair = row({ page, name: "Chair 1" });
  const chairInspect = chair.getByRole("img", { name: /inspect/ });
  await chairInspect.scrollIntoViewIfNeeded();
  await expect(chairInspect.locator("canvas")).toBeVisible();
  const chairModelRequests = () =>
    modelRequests.filter((url) => url.includes("/model-0/")).length;
  const requestsBeforeResize = chairModelRequests();
  const beforeResize = await chairInspect.screenshot();
  const width = chair.getByLabel("width");
  await width.fill("2");
  await width.press("Enter");
  await expect.poll(async () => (await items(page)).at(0)?.sizeM.width).toBe(2);
  await expect
    .poll(async () => (await chairInspect.screenshot()).equals(beforeResize))
    .toBe(false);
  await expect(chairInspect.locator("canvas")).toBeVisible();
  expect(chairModelRequests()).toBe(requestsBeforeResize);
  expect(
    await page.evaluate(() => window.plannerWebglContexts.length),
  ).toBeLessThanOrEqual(2);
});

test("Esc and walk keys stay inside the + picker", async ({ page }) => {
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const add = page.getByRole("button", { name: "Add", exact: true });
  const picker = page.getByRole("dialog", { name: "Add", exact: true });
  const search = picker.getByRole("combobox", {
    name: "Search objects to add",
  });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await add.click();
  await picker.getByRole("option", { name: /Spare lamp/ }).click();
  await expect(inspector).toContainText("Spare lamp");
  await add.click();
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(picker).toBeHidden();
  await expect(inspector).toContainText("Spare lamp");
  await expect(add).toBeFocused();

  await add.click();
  await search.press("Tab");
  await expect(picker).toBeHidden();

  const scene = page.getByTestId("scene");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("w");
  await expect(scene).toHaveAttribute("data-navigation", "walk");
  const camera = await scene.getAttribute("data-camera");
  await add.click();
  await expect(search).toBeFocused();
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  await expect(search).toHaveValue("w");
  expect(await scene.getAttribute("data-camera")).toBe(camera);
  await expect(scene).toHaveAttribute("data-navigation", "walk");
  await search.press("Escape");
  await expect(picker).toBeHidden();
  await expect(scene).toHaveAttribute("data-navigation", "walk");
});

test("the + picker lists built-in ports and project models, narrows by search, and places one item with one undo", async ({
  page,
}) => {
  await trackContexts(page);
  const fixture = await setup({ page, count: 1 });
  fixture.ready(0);
  await load({ page, projectId: fixture.projectId, camera: fixture.camera });
  const add = page.getByRole("button", { name: "Add", exact: true });
  await add.click();
  const picker = page.getByRole("dialog", { name: "Add", exact: true });
  const search = picker.getByRole("combobox", {
    name: "Search objects to add",
  });
  await expect(search).toBeFocused();
  await expect(
    picker.getByRole("group", { name: "Start from" }).getByRole("option"),
  ).toHaveText(["From photo", "From prompt", /^Variant of selection/]);
  await expect(
    picker.getByRole("option", { name: /^Variant of selection/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    picker.getByRole("group", { name: "Built-in" }).getByRole("option"),
  ).toHaveCount(7);
  const models = picker
    .getByRole("group", { name: "Project models" })
    .getByRole("option");
  await expect(models).toHaveCount(2);
  await expect(models.filter({ hasText: "Chair 1" })).toContainText(
    "1 in room",
  );
  await expect(models.filter({ hasText: "Spare lamp" })).toContainText(
    "0 in room",
  );
  await page.screenshot({ path: join(evidence, "add-picker.png") });

  function active() {
    return picker.locator('[role="option"][aria-selected="true"]');
  }
  await expect(active()).toHaveText("From photo");
  await search.press("ArrowDown");
  await expect(active()).toHaveText("From prompt");
  await search.press("ArrowDown");
  await expect(active()).toContainText("Type G (UK, Malaysia, Singapore)");
  await search.press("ArrowUp");
  await expect(active()).toHaveText("From prompt");
  await search.press("Escape");
  await expect(picker).toBeHidden();
  await expect(add).toBeFocused();

  const original = await items(page);
  await add.click();
  await search.fill("lamp");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await expect(active()).toContainText("Spare lamp");
  await search.press("Enter");
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  const placed = (await items(page)).at(1);
  expect(placed?.model).toEqual({ kind: "asset", assetId: "spare-lamp" });
  expect(placed?.placement).toMatchObject({ kind: "floor", elevationM: 0 });
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toContainText("Spare lamp");
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Meta+z");
  await expect.poll(() => items(page)).toEqual(original);

  await add.click();
  await picker.getByRole("option", { name: /Chair 1/ }).click();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page)).at(1)?.model).toEqual({
    kind: "asset",
    assetId: "fixture-model",
  });
  await add.click();
  await expect(
    picker.getByRole("option", { name: /^Variant of selection/ }),
  ).toHaveAttribute("aria-disabled", "false");
  await picker.getByRole("option", { name: /Spare lamp/ }).click({
    button: "right",
  });
  await picker
    .getByRole("option", { name: /Spare lamp/ })
    .click({ modifiers: ["Control"] });
  await expect(add).toHaveAttribute("aria-expanded", "true");
  await expect(search).toBeFocused();
  expect(await items(page)).toHaveLength(2);
  await picker.getByRole("option", { name: /^Variant of selection/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("tab", { name: "Selected" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await add.click();
  await picker.getByRole("option", { name: /Type C\/F/ }).click();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await items(page)).length).toBe(3);
  expect((await items(page)).at(2)?.model).toEqual({
    kind: "asset",
    assetId: "charging-port-type-c-f",
  });
  await add.click();
  await expect(
    picker.getByRole("group", { name: "Built-in" }).getByRole("option").first(),
  ).toContainText("Type C/F");
  const chooser = page.waitForEvent("filechooser");
  await picker.getByRole("option", { name: "From photo" }).click();
  await chooser;
  await expect(picker).toBeHidden();
  await add.click();
  await picker.getByRole("option", { name: "From prompt" }).click();
  await expect(picker).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeFocused();
  await add.click();
  await expect(search).toBeFocused();
  await page.mouse.click(viewport.width / 2, viewport.height - 120);
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await expect(add).not.toBeFocused();
  expect(
    await page.evaluate(() => window.plannerWebglContexts.length),
  ).toBeLessThanOrEqual(2);
});
