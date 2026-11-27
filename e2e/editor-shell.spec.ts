import {
  type ElementHandle,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const chrome = '[data-testid="chrome"] [data-chrome]';

async function chromeCoverage(page: Page) {
  return page.evaluate((selector) => {
    const boxes = Array.from(document.querySelectorAll(selector))
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .map((element) => element.getBoundingClientRect());
    const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
    return {
      count: boxes.length,
      ratio: area / (window.innerWidth * window.innerHeight),
    };
  }, chrome);
}

function recordComposerTransforms(options: { page: Page; frameCount: number }) {
  return options.page.evaluate(
    (count) =>
      new Promise<{ transform: string; docked: string }[]>((resolve) => {
        const seen: { transform: string; docked: string }[] = [];
        function sample() {
          const composer = document.querySelector('[data-testid="composer"]');
          seen.push({
            transform: composer
              ? getComputedStyle(composer).transform
              : "missing",
            docked: composer?.getAttribute("data-docked") ?? "missing",
          });
          if (seen.length < count) {
            requestAnimationFrame(sample);
          } else {
            resolve(seen);
          }
        }
        requestAnimationFrame(sample);
      }),
    options.frameCount,
  );
}

async function measure(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("element box not measured");
  }
  return box;
}

async function waitForComposerToSettle(composer: Locator) {
  await expect
    .poll(() =>
      composer.evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe("none");
}

async function isCurrentComposer(node: ElementHandle | null) {
  if (node === null) {
    throw new Error("composer node not found");
  }
  return node.evaluate(
    (element) => element === document.querySelector('[data-testid="composer"]'),
  );
}

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  const project = await createProject({
    name: "Living room",
    widthM: 4.8,
    depthM: 3.4,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("room-size")).toHaveText(
    "4.80 × 3.40 × 2.60 m",
  );
  await expect(page.getByTestId("composer")).toBeVisible();
  return errors;
}

test("chrome covers under 8% of a 1440 × 900 window with panels collapsed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openEditor(page);
  const coverage = await chromeCoverage(page);
  expect(coverage.count, "visible chrome boxes").toBeGreaterThanOrEqual(8);
  expect(
    coverage.ratio,
    `chrome covers ${(coverage.ratio * 100).toFixed(2)}%`,
  ).toBeLessThan(0.08);
  expect(errors, "console errors").toEqual([]);
  console.log(
    `chrome coverage ${(coverage.ratio * 100).toFixed(2)}% over ${coverage.count} boxes`,
  );
});

test("backslash hides all chrome and shows it again", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("\\");
  expect(
    (await chromeCoverage(page)).count,
    "visible chrome after hiding",
  ).toBe(0);
  await expect(page.getByTestId("composer")).toBeHidden();
  await page.keyboard.press("\\");
  expect(
    (await chromeCoverage(page)).count,
    "visible chrome after showing",
  ).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId("composer")).toBeVisible();
});

test("tool keys switch the active tool and slash focuses the prompt", async ({
  page,
}) => {
  await openEditor(page);
  const toolbar = page.getByRole("toolbar", { name: "Tools" });
  for (const [key, name] of [
    ["r", "Rotate"],
    ["v", "Select"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(
      toolbar.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(
    toolbar.getByRole("button", { name: "Move", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("r");
  await page.keyboard.press("g");
  await expect(
    toolbar.getByRole("button", { name: "Rotate", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+k");
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("Move tool");
  await expect(page.getByText("no matching commands")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await expect(page.getByLabel("Message")).toBeFocused();
  await expect(page.getByLabel("Message")).toHaveValue("");
});

test("opening chat moves the same composer node into the panel and back", async ({
  page,
}) => {
  await openEditor(page);
  const composer = page.getByTestId("composer");
  const input = page.getByLabel("Message");
  const chatButton = page.getByRole("button", { name: "chat", exact: true });
  await input.fill("a green armchair");
  await input.focus();
  const node = await composer.elementHandle();
  const closedBox = await measure(composer);

  const recording = recordComposerTransforms({ page, frameCount: 30 });
  await chatButton.click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(composer).toHaveAttribute("data-docked", "true");
  expect(
    (await recording).some((frame) => frame.transform !== "none"),
    "composer moves with a transform",
  ).toBe(true);
  await waitForComposerToSettle(composer);
  const panelBox = await measure(page.getByTestId("chat-panel"));
  const openBox = await measure(composer);
  expect(
    Math.abs(openBox.x + openBox.width - (panelBox.x + panelBox.width)),
    "composer right edge on the panel's right edge",
  ).toBeLessThan(2);
  expect(
    Math.abs(openBox.y + openBox.height - (panelBox.y + panelBox.height)),
    "composer bottom edge on the panel's bottom edge",
  ).toBeLessThan(2);
  expect(openBox.x, "composer moved right").toBeGreaterThan(closedBox.x);
  expect(await isCurrentComposer(node), "same node after opening").toBe(true);
  await expect(input).toHaveValue("a green armchair");
  await expect(input).toBeFocused();

  await chatButton.click();
  await expect(page.getByTestId("chat-panel")).toBeHidden();
  await expect(composer).toHaveAttribute("data-docked", "false");
  await waitForComposerToSettle(composer);
  const backBox = await measure(composer);
  expect(Math.abs(backBox.x - closedBox.x), "back to its x").toBeLessThan(1);
  expect(Math.abs(backBox.y - closedBox.y), "back to its y").toBeLessThan(1);
  expect(await isCurrentComposer(node), "same node after closing").toBe(true);
  await expect(input).toHaveValue("a green armchair");
  await expect(input).toBeFocused();
});

test("slash shows hidden chrome and focuses the prompt", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("\\");
  await expect(page.getByTestId("composer")).toBeHidden();
  await page.keyboard.press("/");
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByLabel("Message")).toBeFocused();
});

test("photos attach as images only, up to 6, and can be removed", async ({
  page,
}) => {
  await openEditor(page);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const photos = Array.from({ length: 7 }, (_, index) => ({
    name: `photo-${index}.png`,
    mimeType: "image/png",
    buffer: png,
  }));
  await page
    .locator('[data-testid="composer"] input[type="file"]')
    .setInputFiles([
      ...photos,
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
    ]);
  const removeButtons = page.getByRole("button", { name: /^Remove / });
  await expect(removeButtons).toHaveCount(6);
  await expect(page.getByLabel("Message")).toBeFocused();
  await removeButtons.first().click();
  await expect(removeButtons).toHaveCount(5);

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "drop.png", { type: "image/png" }));
    window.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }),
    );
  });
  await expect(page.getByText("Drop photo to attach")).toBeVisible();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "drop.png", { type: "image/png" }));
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true }),
    );
  });
  await expect(page.getByText("Drop photo to attach")).toBeHidden();
  await expect(removeButtons).toHaveCount(6);

  await removeButtons.first().click();
  await page.getByLabel("Message").evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "paste.png", { type: "image/png" }));
    input.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Remove paste.png" }),
  ).toBeVisible();
  await expect(removeButtons).toHaveCount(6);
});

test("the inspector shows only with a selection and moves into chat", async ({
  page,
}) => {
  const project = await createProject({
    name: "Inspector",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const camera = {
    positionM: { x: 0, y: 6, z: 6 },
    targetM: { x: 0, y: 0, z: 0 },
  };
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "sofa",
        name: "Sofa",
        model: { kind: "pending", jobId: "job-sofa" },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 2.1, height: 0.82, depth: 0.9 },
        locked: false,
      },
    },
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("item-tag").first()).toBeAttached();
  await page.keyboard.press("l");
  await expect(page.getByTestId("item-tag")).toHaveText("Sofa · queued");
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeHidden();
  const sofa = projectToScreen({
    camera,
    pointM: { x: 0, y: 0.82, z: 0 },
    viewport: { width: 1440, height: 900 },
  });
  await page.mouse.click(sofa.x, sofa.y);
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel("width")).toHaveValue("2.10");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole("tab", { name: "Selected" }).click();
  await expect(page.getByTestId("chat-panel").getByText("Sofa")).toBeVisible();
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
});

test("the job strip opens the Jobs tab", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Jobs: 0 of 0 ready" }).click();
  await expect(page.getByRole("tab", { name: "Jobs" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("reduced motion swaps the composer with no movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openEditor(page);
  const recording = recordComposerTransforms({ page, frameCount: 30 });
  await page.getByRole("button", { name: "chat", exact: true }).click();
  const frames = await recording;
  expect(
    frames.some((frame) => frame.docked === "true"),
    "composer docked within the recorded frames",
  ).toBe(true);
  await expect(page.getByTestId("composer")).toHaveAttribute(
    "data-docked",
    "true",
  );
  expect(
    frames.every((frame) => frame.transform === "none"),
    `composer transforms ${frames.map((frame) => frame.transform).join(" | ")}`,
  ).toBe(true);
});

test("computed styles match the design tokens", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const title = document.querySelector('[data-testid="project-title"]');
    const root = getComputedStyle(document.documentElement);
    return {
      background: body.backgroundColor,
      color: body.color,
      accent: root.getPropertyValue("--accent").trim(),
      bodyFont: body.fontFamily,
      titleFont: title ? getComputedStyle(title).fontFamily : "",
      loadedFaces: Array.from(document.fonts)
        .filter((face) => face.status === "loaded")
        .map((face) => face.family),
    };
  });
  expect(styles.background).toBe("rgb(244, 241, 234)");
  expect(styles.color).toBe("rgb(27, 36, 48)");
  expect(styles.accent.toLowerCase()).toBe("#1e50e6");
  expect(styles.bodyFont).toMatch(/GeistMono/);
  expect(styles.titleFont).toMatch(/Instrument Serif/);
  expect(styles.loadedFaces, "loaded font faces").toEqual(
    expect.arrayContaining(["GeistMono", "Instrument Serif"]),
  );

  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "chat", exact: true }),
  ).toHaveCSS("color", "rgb(30, 80, 230)");
});

test("other pages use the centred 720 px column", async ({ page }) => {
  for (const path of ["/", "/settings", "/projects/demo/capture"]) {
    await page.goto(path);
    const column = await page.locator("main").boundingBox();
    expect(column?.width, `${path} column width`).toBeLessThanOrEqual(720);
    expect(
      Math.abs((column?.x ?? 0) * 2 + (column?.width ?? 0) - 1440),
      `${path} centred`,
    ).toBeLessThan(2);
  }
});
