import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultLight } from "@planner/shared/src/scene/get-default-light.ts";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { mockGeneration } from "./mock-generation.ts";

const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a26-evidence";
const before = process.env.PLANNER_ALIGNMENT_BEFORE === "1";

async function screenshotJobs(page: Page) {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, `${before ? "before" : "after"}-jobs.png`),
  });
}

async function columns(options: {
  rows: Locator;
  cells: string[];
  right?: string[];
  relative?: boolean;
}) {
  if (before) return;
  await expect.poll(() => options.rows.count()).toBeGreaterThan(1);
  const measurements = await options.rows.evaluateAll(
    (rows, options) =>
      rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        cells: options.cells.map((selector) => {
          const cell = row.querySelector(selector);
          if (!(cell instanceof HTMLElement))
            throw new Error(`Missing alignment cell ${selector}`);
          const rect = cell.getBoundingClientRect();
          return {
            left:
              rect.left -
              (options.relative ? row.getBoundingClientRect().left : 0),
            right:
              rect.right -
              (options.relative ? row.getBoundingClientRect().left : 0),
            wraps: cell.scrollHeight > cell.clientHeight + 0.5,
            whitespace: getComputedStyle(cell).whiteSpace,
            singleLine:
              cell instanceof HTMLInputElement ||
              cell instanceof HTMLSelectElement,
          };
        }),
      })),
    { cells: options.cells, relative: options.relative },
  );
  const first = measurements.at(0);
  if (!first) throw new Error("No alignment rows");
  for (const row of measurements) {
    expect(Math.abs(row.height - first.height)).toBeLessThanOrEqual(0.5);
    for (const [index, cell] of row.cells.entries()) {
      const reference = first.cells.at(index);
      if (!reference) throw new Error("Missing reference cell");
      const edge = options.right?.includes(options.cells.at(index) ?? "")
        ? "right"
        : "left";
      expect(Math.abs(cell[edge] - reference[edge])).toBeLessThanOrEqual(0.5);
      expect(cell.wraps).toBe(false);
      if (!cell.singleLine)
        expect(["nowrap", "pre"]).toContain(cell.whitespace);
    }
  }
}

async function fields(options: { panel: Locator }) {
  if (before) return;
  const grids = options.panel.locator(".field-grid");
  expect(await grids.count()).toBeGreaterThan(0);
  for (const grid of await grids.all()) {
    const controls = grid.locator("input[inputmode=decimal]");
    if ((await controls.count()) < 2) continue;
    const rects = await controls.evaluateAll((nodes) =>
      nodes.map((node) => {
        const label = document.querySelector(`label[for="${node.id}"]`);
        if (!(label instanceof HTMLElement))
          throw new Error("Missing field label");
        const rect = node.getBoundingClientRect();
        return {
          left: label.getBoundingClientRect().left,
          right: rect.right,
          height: rect.height,
          whitespace: getComputedStyle(label).whiteSpace,
        };
      }),
    );
    const first = rects.at(0);
    if (!first) throw new Error("Missing numeric fields");
    for (const rect of rects) {
      expect(Math.abs(rect.left - first.left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(rect.right - first.right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(rect.height - first.height)).toBeLessThanOrEqual(0.5);
      expect(rect.whitespace).toBe("nowrap");
    }
  }
}

test("alignment across editor lists, panels and page rows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockGeneration({
    page,
    count: 4,
    name: "A long room title that must never push dimensions or the top strip controls out of alignment",
    messages: [
      {
        id: "alignment-chat",
        author: { kind: "agent", role: "designer" },
        status: "done",
        createdAt: "2026-11-23T00:00:00Z",
        blocks: [
          {
            kind: "diff",
            changes: [
              { label: "width", before: "0.10 m", after: "12.00 m" },
              {
                label: "A longer property name",
                before: "12.00 m",
                after: "0.00 m",
              },
            ],
            undo: [],
          },
        ],
      },
    ],
    handleCommand(command) {
      if (command.type === "generation.start")
        return { ok: false, error: "Alignment fixture retry error" };
      if (command.type === "photos.list")
        return {
          ok: true,
          result: {
            photos: [999, 4032].map((widthPx, index) => ({
              kind: "accepted",
              photoId: `capture-${index}`,
              origin: "capture",
              sourceFileName: `capture-${index}.jpg`,
              widthPx,
              heightPx: index === 0 ? 1200 : 3024,
              orientation: 1,
              blurScore: 200,
              uprightPath: `upright/capture-${index}.jpg`,
              visionPath: `vision/capture-${index}.jpg`,
              visionWidthPx: 1024,
              visionHeightPx: 768,
            })),
          },
        };
      if (command.type === "reconstruction.scale.get")
        return {
          ok: true,
          result: {
            sources: [
              {
                kind: "measurement",
                axis: "height",
                lengthM: 2.6,
                label: "Room",
              },
              {
                kind: "measurement",
                axis: "width",
                lengthM: 12,
                label: "A long room measurement label that must truncate",
              },
            ],
          },
        };
      return undefined;
    },
  });
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-1",
      patch: {
        name: "A long furniture name that must truncate at the same title edge as every other row",
      },
    },
  });
  fixture.apply({
    command: {
      type: "item.update",
      itemId: "item-0",
      patch: {
        light: getDefaultLight({
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        }),
      },
    },
  });
  await page.route(`**/projects/${fixture.projectId}/photos/*`, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: readFileSync(
        new URL(
          "../src/capture/e2e/fixtures/b15-wallpaper.png",
          import.meta.url,
        ),
      ),
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto(`/projects/${fixture.projectId}`);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Chat", exact: true }),
  ).toBeVisible();
  await columns({
    rows: page.locator(".diff-row"),
    cells: [":scope > span:first-child", ":scope > span:last-child"],
    right: [":scope > span:last-child"],
  });
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  fixture.stage({ index: 0, stage: "failed", progress: 0 });
  fixture.stage({ index: 1, stage: "ready", progress: 1 });
  fixture.stage({ index: 2, stage: "generating", progress: 0.7 });
  fixture.stage({ index: 3, stage: "queued", progress: 0 });
  await expect(
    page.getByRole("button", { name: "Retry model · Chair 1", exact: true }),
  ).toBeVisible();
  await screenshotJobs(page);
  await columns({
    rows: page.locator("[data-job-id] > summary"),
    cells: [".job-title", ".job-action", ".job-stage", ".job-percent"],
    right: [".job-percent"],
  });
  if (!before) {
    await page
      .getByRole("button", { name: "Retry model · Chair 1", exact: true })
      .click();
    await expect(page.getByText("Alignment fixture retry error")).toBeHidden();
    await page.locator('[data-job-id="job-0"] > summary').click();
    await expect(page.getByText("Alignment fixture retry error")).toBeVisible();
  }
  await page.getByRole("tab", { name: "Log", exact: true }).click();
  await columns({
    rows: page.locator(".log-summary"),
    cells: ["time", ".log-kind"],
  });
  await page.getByRole("tab", { name: "Objects", exact: true }).click();
  const objects = page.getByRole("region", { name: "Project objects" });
  await expect(objects.getByRole("article")).toHaveCount(11);
  await columns({
    rows: objects.locator(".object-summary"),
    cells: [".object-title", ".object-info"],
  });
  await objects.getByRole("button", { name: /Chair 1.*1.20/ }).click();
  await fields({ panel: page.getByTestId("inspector-body") });
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const inspector = page.getByRole("complementary", {
    name: "Inspector",
    exact: true,
  });
  await expect(inspector).toBeVisible();
  if (!before) {
    const overflow = await inspector.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      const body = panel.querySelector('[data-testid="inspector-body"]');
      if (!(body instanceof HTMLElement))
        throw new Error("Missing inspector body");
      return {
        width: bounds.width,
        outer: panel.scrollWidth - panel.clientWidth,
        body: body.scrollWidth - body.clientWidth,
        controls: Array.from(panel.querySelectorAll("input")).map(
          (control) => ({
            left: control.getBoundingClientRect().left - bounds.left,
            right: bounds.right - control.getBoundingClientRect().right,
          }),
        ),
      };
    });
    expect(overflow.width).toBe(300);
    expect(overflow.outer).toBeLessThanOrEqual(0.5);
    expect(overflow.body).toBeLessThanOrEqual(0.5);
    for (const control of overflow.controls) {
      expect(control.left).toBeGreaterThanOrEqual(12);
      expect(control.right).toBeGreaterThanOrEqual(12);
    }
    await fields({ panel: inspector });
  }
  await page.getByTestId("scene").locator("canvas").focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menu", { name: "Chair 1", exact: true }),
  ).toBeVisible();
  if (!before) {
    const heights = await page
      .getByRole("menuitem")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
      0.5,
    );
  }
  await page.keyboard.press("Escape");
  await page.getByTestId("room-size").click();
  const roomPanel = page.getByRole("dialog", { name: "Room" });
  await fields({ panel: roomPanel });
  await roomPanel.getByRole("button", { name: "floor", exact: true }).click();
  await roomPanel.getByLabel("Material", { exact: true }).selectOption("tiles");
  await columns({
    rows: roomPanel.locator("label.aligned-row:has(input[type=number])"),
    cells: ["span", "input"],
    right: ["input"],
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await columns({
    rows: page.locator('[role="option"] > button'),
    cells: [".picker-title"],
  });
  await page.keyboard.press("Escape");
  if (!before) {
    const title = await page.getByTestId("project-title").boundingBox();
    const dimensions = await page.getByTestId("room-size").boundingBox();
    if (!title || !dimensions) throw new Error("Missing top strip");
    expect(title.x + title.width).toBeLessThanOrEqual(dimensions.x);
    expect(
      Math.abs(
        title.y + title.height / 2 - dimensions.y - dimensions.height / 2,
      ),
    ).toBeLessThanOrEqual(0.5);
    const buttons = await page
      .locator("header > button, header > a")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, right: rect.right, height: rect.height };
        }),
      );
    const first = buttons.at(0);
    if (!first) throw new Error("Missing top strip controls");
    for (const button of buttons) {
      expect(Math.abs(button.top - first.top)).toBeLessThanOrEqual(0.5);
      expect(button.height).toBe(28);
      expect(button.right).toBeLessThanOrEqual(1440);
    }
  }
  if (!before) {
    const sizes = await page
      .getByRole("toolbar", { name: "Tools" })
      .locator(":scope > button, :scope > div > button")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
    expect(sizes).toEqual(
      Array.from({ length: 3 }, () => ({ width: 36, height: 36 })),
    );
  }
  await page.goto(`/projects/${fixture.projectId}/capture`);
  await expect(
    page
      .getByRole("list", { name: "Saved scale sources" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await columns({
    rows: page.locator("figure figcaption.aligned-row"),
    relative: true,
    cells: [":scope > span:first-child", ":scope > span:last-child"],
    right: [":scope > span:last-child"],
  });
  await columns({
    rows: page.locator(".scale-row"),
    cells: [".scale-label", ".scale-value"],
    right: [".scale-value"],
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("signed in", { exact: true }).first(),
  ).toBeVisible();
  await columns({
    rows: page.locator(".role-model-row"),
    cells: ["label", "select", "input", "button"],
  });
  await columns({
    rows: page.locator(".usage-row"),
    cells: [".usage-title", ".usage-percent", ".usage-reset"],
    right: [".usage-percent"],
  });
  await createProject({
    name: "Short room",
    widthM: 3,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await createProject({
    name: "A long project name that must end at the same edge as other names in the project list",
    widthM: 3,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  await page.goto("/");
  await columns({
    rows: page.locator(".hairline-row"),
    cells: [".hairline-title", ".hairline-action"],
  });
});
