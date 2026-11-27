import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const landingUrl = "http://localhost:39024/";
const siteDir = resolve("marketing/roomkit");
const englishUrl = "https://www.roomkit.space/";
const macRelease = JSON.parse(
  readFileSync(resolve(siteDir, "macos-release.json"), "utf8"),
);
const expectedCommands = [
  "npm install --global pnpm@10.34.9",
  `git clone https://github.com/xmliszt/roomkit.git
cd roomkit
pnpm install --frozen-lockfile`,
  "pnpm daemon",
  "pnpm web",
  String.raw`PLANNER_WEB_ORIGIN='http://localhost:3210,http://127.0.0.1:3210,https://roomkit-host.example-tailnet.ts.net:8443' \
PLANNER_ALLOWED_HOSTS='roomkit-host.example-tailnet.ts.net:8443' \
PLANNER_TAILNET_LOGINS='you@example.com' pnpm daemon`,
  "PLANNER_ALLOWED_HOSTS='roomkit-host.example-tailnet.ts.net:8443' pnpm web",
  "sh scripts/tailnet-serve.sh",
  "sh scripts/tailnet-serve.sh off",
];
const requiredLocales = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt-BR",
  "it",
  "nl",
  "tr",
  "ru",
  "uk",
  "pl",
  "id",
  "vi",
  "hi",
];

test.use({
  hasTouch: true,
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    ...(process.env.PLANNER_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PLANNER_BROWSER_EXECUTABLE }
      : {}),
    args: [
      "--enable-unsafe-swiftshader",
      "--disable-features=OverlayScrollbar",
    ],
  },
});

function buildLanding(hosted: boolean) {
  execFileSync(process.execPath, [resolve(siteDir, "build.mjs")], {
    env: { ...process.env, ROOMKIT_HOSTED_RELEASES: hosted ? "1" : "0" },
  });
}

test.beforeAll(() => buildLanding(false));

test.beforeEach(async ({ page }) => {
  await page.route(`${landingUrl}**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === "_vercel/insights/script.js") {
      return route.fulfill({ contentType: "text/javascript", body: "" });
    }
    return route.fulfill({
      path: resolve(
        siteDir,
        "dist",
        !path || path.endsWith("/") ? `${path}index.html` : path,
      ),
    });
  });
  await page.route("https://cdn.jsdelivr.net/npm/three@*/**", (route) => {
    const path = new URL(route.request().url()).pathname
      .split("/")
      .slice(3)
      .join("/");
    return route.fulfill({
      path: resolve("node_modules/three", path),
      headers: { "access-control-allow-origin": "*" },
    });
  });
});

test("the hero orbits at rest and the room responds directly without controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto(landingUrl);
  const hero = page.locator("#room-preview");
  const canvas = hero.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(hero.getByRole("button")).toHaveCount(0);
  await expect(canvas).toHaveCSS("cursor", "default");
  const initial = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(initial))
    .toBe(false);

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Room preview has no bounds");
  await page.mouse.move(bounds.x + 14, bounds.y + 14);
  const hovering = await canvas.screenshot();
  await page.clock.fastForward(360);
  expect((await canvas.screenshot()).equals(hovering)).toBe(false);
  await page.mouse.down();
  const held = await canvas.screenshot();
  await page.clock.fastForward(1200);
  expect((await canvas.screenshot()).equals(held)).toBe(true);
  await page.mouse.up();
  await page.clock.fastForward(900);
  expect((await canvas.screenshot()).equals(held)).toBe(false);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await canvas.screenshot();
  await page.mouse.move(bounds.x + 14, bounds.y + 14);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 114, bounds.y + 26);
  await page.mouse.up();
  expect((await canvas.screenshot()).equals(still)).toBe(false);

  await canvas.press("Space");
  const selected = await canvas.screenshot();
  await canvas.press("ArrowRight");
  const moved = await canvas.screenshot();
  expect(moved.equals(selected)).toBe(false);
  await canvas.press("r");
  const rotated = await canvas.screenshot();
  expect(rotated.equals(moved)).toBe(false);
  await canvas.press("l");
  expect((await canvas.screenshot()).equals(rotated)).toBe(false);
  const titlePositions = await page
    .locator(".tool h3")
    .evaluateAll((headings) =>
      headings.map((heading) => heading.getBoundingClientRect().top),
    );
  expect(new Set(titlePositions).size).toBe(1);
});

test("the first framed print has one front surface", async ({ page }) => {
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);
  const projectedCoverage = await page.evaluate(async () => {
    const [{ Mesh }, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ]);
    const { scene } = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync("/assets/living-room.glb");
    const print = scene
      .getObjectByName("Framed_print")
      ?.children.find((part) => part instanceof Mesh);
    if (!print) throw new Error("Missing first framed print");

    const { geometry } = print;
    const indices = geometry.getIndex();
    const positions = geometry.getAttribute("position");
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!indices || !bounds) throw new Error("Missing framed-print geometry");

    let frontArea = 0;
    for (let offset = 0; offset < indices.count; offset += 3) {
      const a = indices.getX(offset);
      const b = indices.getX(offset + 1);
      const c = indices.getX(offset + 2);
      const abX = positions.getX(b) - positions.getX(a);
      const abY = positions.getY(b) - positions.getY(a);
      const acX = positions.getX(c) - positions.getX(a);
      const acY = positions.getY(c) - positions.getY(a);
      frontArea += Math.max(0, (abX * acY - abY * acX) / 2);
    }
    const boundsArea =
      (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y);
    return frontArea / boundsArea;
  });
  expect(projectedCoverage).toBeCloseTo(1, 1);
});

test("the hero zooms with the wheel and stops at both limits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(landingUrl);
  const canvas = page.locator("#room-preview[data-ready] canvas");
  await canvas.hover({ position: { x: 14, y: 14 } });

  function getBackgroundOpacity() {
    return canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext("webgl2");
      if (!context) throw new Error("Hero canvas has no WebGL context");
      return context.getParameter(context.COLOR_CLEAR_VALUE)[3];
    });
  }

  const wheelToLimit = 3000;
  const initial = await canvas.screenshot();
  expect(await getBackgroundOpacity()).toBe(0);
  await page.mouse.wheel(0, -900);
  await expect.poll(getBackgroundOpacity).toBeGreaterThan(0);
  expect(await getBackgroundOpacity()).toBeLessThan(1);
  await page.mouse.wheel(0, -wheelToLimit);
  const zoomedIn = await canvas.screenshot();
  expect(await getBackgroundOpacity()).toBe(1);
  expect(zoomedIn.equals(initial)).toBe(false);
  await page.mouse.wheel(0, -wheelToLimit);
  expect((await canvas.screenshot()).equals(zoomedIn)).toBe(true);

  await page.mouse.wheel(0, wheelToLimit);
  const zoomedOut = await canvas.screenshot();
  expect(zoomedOut.equals(zoomedIn)).toBe(false);
  expect(zoomedOut.equals(initial)).toBe(false);
  await page.mouse.wheel(0, wheelToLimit);
  expect((await canvas.screenshot()).equals(zoomedOut)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await canvas.press("Equal");
  expect((await canvas.screenshot()).equals(zoomedOut)).toBe(false);

  await page.mouse.move(10, 80);
  await page.mouse.wheel(0, 250);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});

test("workflow starts automatically and mobile selections stay in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.clock.install();
  await page.goto(landingUrl);
  await page.locator("#workflow").evaluate((section) => {
    section.scrollIntoView({ block: "start", behavior: "instant" });
  });
  const stage = page.locator(".chapter:visible");
  await expect(stage).toHaveAttribute("id", "rebuild-room", { timeout: 9500 });
  const reconstruction = stage.locator("canvas");
  await expect(reconstruction).toBeVisible();
  await page.clock.fastForward(620);
  const cloud = await reconstruction.screenshot();
  await page.clock.fastForward(640);
  const tracing = await reconstruction.screenshot();
  expect(tracing.equals(cloud)).toBe(false);
  await page.clock.fastForward(1420);
  expect((await reconstruction.screenshot()).equals(tracing)).toBe(false);

  await page.getByRole("link", { name: /Place furniture/ }).tap();
  const placement = stage.locator("canvas");
  await expect(placement).toBeVisible();
  await page.clock.fastForward(490);
  const generating = await placement.screenshot();
  await page.clock.fastForward(2500);
  expect((await placement.screenshot()).equals(generating)).toBe(false);

  const walk = page.getByRole("link", { name: /Walk through/ });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await walk.tap();
  await expect(stage).toHaveAttribute("id", "walk-room");
  await expect(walk).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  const walkView = stage.locator("canvas");
  await expect(walkView).toBeVisible();
  const startOfWalk = await walkView.screenshot();
  await page.clock.fastForward(13200);
  expect((await walkView.screenshot()).equals(startOfWalk)).toBe(false);

  await page.getByRole("link", { name: /Compare views/ }).tap();
  await expect(stage).toHaveAttribute("id", "render-room");
  const comparison = page.getByRole("slider", {
    name: /Compare Roomkit snapshot/,
  });
  await expect(comparison).toHaveValue("50");
  await expect(comparison).toHaveCSS("cursor", "default");
  await comparison.press("ArrowRight");
  await expect(comparison).toHaveValue("51");
  const divider = page.locator(".compare-divider");
  await expect(divider).toBeVisible();
  const handle = await divider.boundingBox();
  if (!handle) throw new Error("Render divider has no bounds");
  const y = handle.y + handle.height / 2;
  await page.mouse.move(handle.x, y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 52, y, { steps: 5 });
  await page.mouse.up();
  const split = await comparison.inputValue();
  expect(Number(split)).toBeGreaterThan(60);
  await expect(page.locator(".render-shot")).toHaveAttribute(
    "style",
    `--split: ${split}%;`,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("the frosted header stays above content and leaves section targets visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/room-preview.js", (route) => route.abort());
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(landingUrl);
    const header = page.locator(".site-header");
    await expect(header).toHaveCSS("backdrop-filter", /blur\(/);
    await header.locator('a[href="#tools"]').click();
    await expect(page).toHaveURL(`${landingUrl}#tools`);
    const layout = await header.evaluate((element) => ({
      headerTop: element.getBoundingClientRect().top,
      headerBottom: element.getBoundingClientRect().bottom,
      targetTop: document.querySelector("#tools")?.getBoundingClientRect().top,
    }));
    expect(layout.headerTop).toBe(0);
    expect(layout.targetTop).toBeGreaterThan(layout.headerBottom);
  }
});

test("the hero action stays visible on mobile and workflow columns have dividers", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);
  await page.evaluate(() => document.fonts.ready);

  const action = page.locator(".hero .button.primary");
  const steps = page.getByRole("navigation", { name: "Workflow steps" });
  await expect(action).toHaveAttribute("href", macRelease.dmg);

  for (const width of [320, 390, 470, 550]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(steps.getByRole("link").first()).toHaveCSS(
      "font-size",
      "12px",
    );
    expect(
      await steps
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => getComputedStyle(link).borderInlineEndWidth),
        ),
    ).toEqual(
      width <= 544
        ? ["1px", "0px", "1px", "0px", "1px", "0px"]
        : ["1px", "1px", "0px", "1px", "1px", "0px"],
    );
  }
});

test("every locale links to the Mac download in the update feed and the checksum", async ({
  page,
}) => {
  const feed = readFileSync(resolve(siteDir, "dist", "appcast.xml"), "utf8");
  expect(feed).toContain(
    `<sparkle:version>${macRelease.version}</sparkle:version>`,
  );
  expect(feed).toContain(`url="${macRelease.dmg}"`);
  for (const locale of requiredLocales) {
    const folder = locale === "en" ? "" : locale;
    const html = readFileSync(
      resolve(siteDir, "dist", folder, "index.html"),
      "utf8",
    );
    const copy = JSON.parse(
      readFileSync(resolve(siteDir, "locales", `${locale}.json`), "utf8"),
    );
    const links = await page.evaluate((html) => {
      const landing = new DOMParser().parseFromString(html, "text/html");
      return {
        downloads: Array.from(
          landing.querySelectorAll(".mac-download"),
          (link) => {
            return {
              href: link.getAttribute("href"),
              label: link.querySelector("span")?.textContent,
              version: link.querySelector("[data-release-version]")
                ?.textContent,
            };
          },
        ),
        requirements: landing.querySelector(".download-actions > p")
          ?.textContent,
        applicationsLabel: landing.querySelector(".applications-label")
          ?.textContent,
        hrefs: Array.from(landing.querySelectorAll("a"), (link) =>
          link.getAttribute("href"),
        ),
        sourceTitle: landing.querySelector("#source-setup h2")?.textContent,
        remoteCopy: Array.from(
          landing.querySelectorAll("#remote .section-copy > p"),
          (paragraph) => paragraph.textContent,
        ),
      };
    }, html);
    const download = {
      href: macRelease.dmg,
      label: copy.macDownload,
      version: macRelease.version,
    };
    expect(links.downloads).toEqual([download, download]);
    expect(links.requirements).toBe(copy.macRequirements);
    expect(links.applicationsLabel).toBe(copy.macApplications);
    expect(links.hrefs).toContain(macRelease.checksum);
    expect(links.sourceTitle).toBe(copy.sourceSetupTitle);
    expect(links.remoteCopy).toEqual([
      copy.remoteIntro,
      copy.remoteSourceIntro,
    ]);
  }
});

test("the hosted download and checksum stay on the displayed release", async ({
  page,
}) => {
  const current = {
    version: "9.9.9",
    dmg: "https://releases.example.test/9.9.9/Roomkit-9.9.9-arm64.dmg",
    checksum:
      "https://releases.example.test/9.9.9/Roomkit-9.9.9-arm64.dmg.sha256",
  };
  const hosted = (() => {
    try {
      buildLanding(true);
      return readFileSync(resolve(siteDir, "dist/index.html"), "utf8");
    } finally {
      buildLanding(false);
    }
  })();
  await page.route(landingUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: hosted }),
  );
  await page.route(`${landingUrl}release.json`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);

  const versions = page.locator(".mac-download [data-release-version]");
  await expect(versions).toHaveText(["9.9.9", "9.9.9"]);
  await expect(
    page.getByRole("link", { name: "Download for Mac 9.9.9" }),
  ).toHaveCount(2);
  await expect(page.locator(".hero .mac-download")).toHaveAttribute(
    "href",
    current.dmg,
  );
  await expect(page.locator("#setup .mac-download")).toHaveAttribute(
    "href",
    current.dmg,
  );
  await expect(page.locator("[data-release-checksum]")).toHaveAttribute(
    "href",
    current.checksum,
  );

  await page.route(`${landingUrl}release.json`, (route) =>
    route.fulfill({ status: 503 }),
  );
  const unavailable = page.waitForResponse(`${landingUrl}release.json`);
  await page.reload();
  expect((await unavailable).status()).toBe(503);
  for (const link of await page
    .getByRole("link", { name: "Download for Mac", exact: true })
    .all()) {
    await expect(link).toHaveAttribute("href", "/downloads/Roomkit.dmg");
    await expect(link.locator("[data-release-version]")).toBeHidden();
  }
  await expect(
    page.getByRole("link", { name: "Download for Mac", exact: true }),
  ).toHaveCount(2);
  await expect(page.locator("[data-release-checksum]")).toHaveAttribute(
    "href",
    "/downloads/Roomkit.dmg.sha256",
  );
});

test("the Mac illustration shows the app being copied into Applications", async ({
  page,
}) => {
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);
  const illustration = page.locator(".install-dmg");
  const installWindow = illustration.locator(".install-window");
  await expect(illustration).not.toHaveAttribute("data-playing", "");
  await installWindow.evaluate((frame) => {
    const bounds = frame.getBoundingClientRect();
    scrollTo({
      top: scrollY + bounds.top + bounds.height * 0.65 - innerHeight,
      behavior: "instant",
    });
  });
  await expect(installWindow).toBeInViewport({ ratio: 0.5 });
  await expect(illustration).not.toHaveAttribute("data-playing", "");
  await illustration.scrollIntoViewIfNeeded();
  await expect(illustration).toHaveAttribute("data-playing", "");
  await expect(illustration.locator(".applications-label")).toHaveText(
    "Applications",
  );
  const { dropX, frames } = await illustration.evaluate((svg) => {
    const movingApp = svg.querySelector(".drag-copy");
    const cursor = svg.querySelector(".drag-cursor");
    const confirmation = svg.querySelector(".drop-confirmation");
    const applications = svg.querySelector(".applications-label");
    const source = svg.querySelector<SVGUseElement>(
      "use[href='#dmg-roomkit-app']",
    );
    if (!movingApp || !cursor || !confirmation || !applications || !source) {
      throw new Error("The illustration is missing animated parts");
    }
    const appBounds = source.getBBox();
    const appCenterX = appBounds.x + appBounds.width / 2;
    const animations = svg.getAnimations({ subtree: true });
    animations.forEach((animation) => {
      animation.pause();
    });
    const frames = [0, 1800, 2806, 4000].map((time) => {
      animations.forEach((animation) => {
        animation.currentTime = time;
      });
      const appStyle = getComputedStyle(movingApp);
      return {
        appOpacity: Number(appStyle.opacity),
        appX: appCenterX + new DOMMatrixReadOnly(appStyle.transform).m41,
        cursorOpacity: Number(getComputedStyle(cursor).opacity),
        cursorX: new DOMMatrixReadOnly(getComputedStyle(cursor).transform).m41,
        copied: Number(getComputedStyle(confirmation).opacity),
      };
    });
    return { dropX: Number(applications.getAttribute("x")), frames };
  });
  expect(frames.at(0)).toMatchObject({
    appOpacity: 0,
    cursorOpacity: 0,
    copied: 0,
  });
  expect(frames.at(1)).toMatchObject({
    appOpacity: 1,
    cursorOpacity: 1,
    copied: 0,
  });
  expect(frames.at(1)?.appX).not.toBe(frames.at(0)?.appX);
  expect(frames.at(1)?.appX).toBeCloseTo(frames.at(1)?.cursorX ?? 0);
  expect(frames.at(2)?.appX).toBeCloseTo(dropX);
  expect(frames.at(2)?.cursorX).toBeCloseTo(dropX);
  expect(frames.at(3)).toMatchObject({
    appOpacity: 0,
    cursorOpacity: 0,
    copied: 1,
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(illustration.locator(".drag-copy")).toHaveCSS("opacity", "0");
  await expect(illustration.locator(".drag-cursor")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("all buttons share padding at desktop and mobile widths", async ({
  page,
}) => {
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("button", { name: /^Copy / }).first(),
  ).toBeVisible();
  const buttons = page.locator("button, .button");
  const heroDownload = page.locator(".hero a, .hero button");
  const setupHeadings = page.locator(
    "section#setup h2, section#source-setup h2",
  );
  const links = page.locator(
    ".brand, .header-inner nav a, .footer-inner a, .language-switcher summary, .language-switcher a, .chapter-list a, .app-tray a",
  );
  await expect(setupHeadings).toHaveText([
    "Download Roomkit",
    "Set up from source (Alternative)",
  ]);
  await expect(heroDownload).toHaveCount(1);
  await expect(heroDownload).toHaveAttribute("href", macRelease.dmg);
  await expect(page.locator("#setup pre")).toHaveCount(0);
  for (const width of [320, 390, 561, 705, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const buttonStyles = await buttons.evaluateAll((elements) =>
      Array.from(
        new Set(
          elements.map((element) => {
            const { padding, fontSize, fontWeight, lineHeight } =
              getComputedStyle(element);
            return [padding, fontSize, fontWeight, lineHeight].join(" / ");
          }),
        ),
      ),
    );
    expect(buttonStyles).toEqual(["10px 16px / 13.5px / 500 / 21px"]);
    await expect(heroDownload).toHaveCSS("height", "44px");
    const headingSizes = await setupHeadings.evaluateAll((headings) =>
      Array.from(
        new Set(headings.map((heading) => getComputedStyle(heading).fontSize)),
      ),
    );
    expect(headingSizes).toHaveLength(1);
    const linkPadding = await links.evaluateAll((elements) =>
      Array.from(
        new Set(elements.map((element) => getComputedStyle(element).padding)),
      ),
    );
    expect(linkPadding).toEqual([width <= 432 ? "6px 4px" : "6px 8px"]);

    await page.locator("#open-other-apps").click();
    const clippedNames = await page
      .locator(".app-tray a")
      .evaluateAll((links) =>
        links.flatMap((link) => {
          if (link.scrollWidth > link.clientWidth) return [link.textContent];
          const label = link.lastChild;
          if (!label) return [];
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getClientRects().length > 1 ? [link.textContent] : [];
        }),
      );
    expect(clippedNames).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#other-apps")).toBeHidden();
  }

  await page.setViewportSize({ width: 561, height: 800 });
  await page.locator("#open-other-apps").click();
  await page.addStyleTag({ content: ".app-tray a { font-size: 20px }" });
  const overflowingNames = await page
    .locator(".app-tray a")
    .evaluateAll((links) =>
      links
        .filter((link) => link.scrollWidth > link.clientWidth)
        .map((link) => link.textContent),
    );
  expect(overflowingNames).toEqual([]);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${landingUrl}fr/`);
  await page.evaluate(() => document.fonts.ready);
  await expect(heroDownload).toHaveCSS("height", "44px");
});

test("reduced motion stops the remote signal and finishes the workflow reveal", async ({
  page,
}) => {
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);
  const diagram = page.locator(".device-diagram");
  const signal = diagram.locator("svg path");
  await diagram.evaluate((element) =>
    element.scrollIntoView({ behavior: "instant", block: "center" }),
  );
  const readSignal = () =>
    signal.evaluate((path) => {
      const style = getComputedStyle(path);
      return {
        opacity: Number(style.opacity),
        offset: Number.parseFloat(style.strokeDashoffset),
      };
    });
  await expect
    .poll(async () => {
      const { opacity, offset } = await readSignal();
      return opacity > 0.8 && offset > 30 && offset < 70;
    })
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await readSignal()).opacity).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.locator('#chapter-list a[href="#reference-furniture"]').click();
  const response = page.locator("#reference-furniture .demo-response");
  const readResponse = () =>
    response.evaluate((element) => Number(getComputedStyle(element).opacity));
  await expect.poll(readResponse).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(readResponse).toBe(1);
});

test("the footer wordmark replays its left-to-right reveal on reentry", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);

  const wordmark = page.locator(".footer-wordmark");
  const letters = wordmark.locator(".footer-wordmark-text > span");
  const readOffsets = () =>
    letters.evaluateAll((nodes) =>
      nodes.map((node) => {
        const translate = getComputedStyle(node).translate;
        return translate === "none"
          ? 0
          : Number.parseFloat(translate.split(" ").at(-1) ?? "");
      }),
    );

  async function revealWordmark() {
    await wordmark.evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "end" }),
    );
    await expect
      .poll(async () => {
        const offsets = await readOffsets();
        return (
          Math.min(...offsets) < 100 &&
          offsets.at(0) === Math.min(...offsets) &&
          offsets.at(-1) === 100
        );
      })
      .toBe(true);
  }

  await expect(wordmark).toHaveCSS("mask-image", "none");
  await expect.poll(readOffsets).toEqual(Array(7).fill(100));
  await revealWordmark();
  await expect.poll(readOffsets).toEqual(Array(7).fill(0));

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(readOffsets).toEqual(Array(7).fill(100));
  await revealWordmark();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(readOffsets).toEqual(Array(7).fill(0));
});

test("the footer opens the app tray and closing it restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.goto(landingUrl);

  const footer = page.locator(".footer-inner");
  const open = footer.getByRole("link", { name: "Other apps" });
  const owner = footer.getByRole("link", { name: "© 2026 Li Yuxuan" });
  await expect(owner).toHaveAttribute("href", "https://liyuxuan.dev/");
  await expect(owner.getByText("Li Yuxuan", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  const license = footer.getByRole("link", { name: "MIT License" });
  await expect(license).toHaveAttribute("href", "/license.txt");
  const dialog = page.getByRole("dialog", { name: "Other apps" });
  await expect(dialog).toBeHidden();
  await open.scrollIntoViewIfNeeded();
  const footerBounds = await footer.boundingBox();
  await open.press("Enter");
  await expect(dialog).toBeVisible();
  expect(await footer.boundingBox()).toEqual(footerBounds);
  await expect(dialog.getByRole("link")).toHaveCount(5);
  const paws = dialog.getByRole("link", { name: "Paws", exact: true });
  await expect(paws).toHaveCSS("font-size", "13.5px");
  await expect(paws).toHaveAttribute("target", "_blank");
  await expect(paws).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(open).toBeFocused();

  await open.click();
  const heading = dialog.getByRole("heading", { name: "Other apps" });
  await heading.hover();
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  await page.mouse.down();
  await heading.hover();
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  const licenseResponsePromise = page.waitForResponse(
    new URL("license.txt", landingUrl).href,
  );
  await license.press("Enter");
  const licenseResponse = await licenseResponsePromise;
  expect(licenseResponse.ok()).toBe(true);
  expect(await licenseResponse.text()).toBe(readFileSync("LICENSE", "utf8"));
});

test("copy feedback preserves the command width", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(landingUrl);
  const copy = page.getByRole("button", {
    name: "Copy command: pnpm daemon",
    exact: true,
  });
  await expect(page.locator("#landing-motion span")).toBeAttached();
  await copy.scrollIntoViewIfNeeded();
  const size = await copy.boundingBox();
  const code = copy.locator("..").locator("pre");
  const codeSize = await code.boundingBox();
  await copy.click();
  await expect(copy).toHaveAttribute("data-copied", "");
  await expect(copy.locator(".copy-check")).toHaveCSS("opacity", "1");
  await expect(copy).toHaveCSS("cursor", "default");
  await expect.poll(() => copy.boundingBox()).toEqual(size);
  expect(await code.boundingBox()).toEqual(codeSize);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "pnpm daemon",
  );

  const stopCommand = "sh scripts/tailnet-serve.sh off";
  const stopCopy = page.getByRole("button", {
    name: `Copy command: ${stopCommand}`,
  });
  await stopCopy.click();
  await expect(stopCopy).toHaveAttribute("data-copied", "");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    stopCommand,
  );
});

test("copy feedback survives overlapping requests without the motion bundle", async ({
  context,
  page,
}) => {
  await page.route("**/room-preview.js", (route) => route.abort());
  await page.route("**/landing-motion.js", (route) => route.abort());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install();
  await page.addInitScript(() => {
    const firstCopy = Promise.withResolvers<void>();
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    let attempts = 0;
    navigator.clipboard.writeText = async (text) => {
      attempts += 1;
      if (attempts === 1) return writeText(text);
      if (attempts === 2) return firstCopy.promise;
      firstCopy.resolve();
      throw new DOMException("Clipboard denied", "NotAllowedError");
    };
  });
  await page.goto(landingUrl);
  const copy = page.getByRole("button", { name: "Copy command: pnpm daemon" });
  await copy.press("Enter");
  await expect(copy).toHaveAttribute("data-copied", "");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "pnpm daemon",
  );
  await copy.press("Enter");
  await copy.press("Enter");
  const feedback = page.getByText("Select the command to copy it manually.");
  await expect(feedback).toBeVisible();
  await page.clock.fastForward(1700);
  await expect(feedback).toBeVisible();
});

test.describe("static locale pages", () => {
  test.use({ javaScriptEnabled: false, locale: "ja" });

  test("each locale is crawlable and publishes the same set of alternates", async ({
    page,
  }) => {
    const publishedLocales = Object.keys(
      JSON.parse(
        readFileSync(resolve(siteDir, "locales/published.json"), "utf8"),
      ),
    );
    expect(publishedLocales).toEqual(expect.arrayContaining(requiredLocales));
    const languages = publishedLocales.map((code) => ({
      code,
      path: code === "en" ? "/" : `/${code}/`,
    }));
    const canonicals = languages.map(
      ({ path }) => new URL(path, englishUrl).href,
    );
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    await page.setViewportSize({ width: 320, height: 800 });
    for (const { code, path } of languages) {
      const url = new URL(path, landingUrl).href;
      const canonical = new URL(path, englishUrl).href;
      expect((await page.goto(url))?.status()).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".install-dmg")).toBeVisible();
      await expect(page.locator(".applications-label")).toBeVisible();
      await expect(page).toHaveURL(url);
      await expect(page.locator("html")).toHaveAttribute("lang", code);
      const { mitLicense } = JSON.parse(
        readFileSync(resolve(siteDir, "locales", `${code}.json`), "utf8"),
      );
      await expect(
        page.locator('.footer-inner a[href="/license.txt"]'),
      ).toHaveAccessibleName(mitLicense);
      await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
        "href",
        canonical,
      );
      const metadata = await page.evaluate(() => ({
        title: document.title,
        description: document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content"),
        socialTitle: document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute("content"),
        socialDescription: document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute("content"),
        socialUrl: document
          .querySelector('meta[property="og:url"]')
          ?.getAttribute("content"),
        structuredData: JSON.parse(
          document.querySelector('script[type="application/ld+json"]')
            ?.textContent ?? "{}",
        ),
        alternates: Array.from(
          document.querySelectorAll('link[rel="alternate"][hreflang]'),
          (link) => [link.getAttribute("hreflang"), link.getAttribute("href")],
        ),
      }));
      expect(metadata.alternates).toEqual([
        ...languages.map(({ code, path }) => [
          code,
          new URL(path, englishUrl).href,
        ]),
        ["x-default", englishUrl],
      ]);
      expect(metadata.socialTitle).toBe(metadata.title);
      expect(metadata.socialUrl).toBe(canonical);
      expect(metadata.socialDescription).toBeTruthy();
      expect(metadata.structuredData).toMatchObject({
        "@type": "SoftwareApplication",
        url: canonical,
        inLanguage: code,
        description: metadata.description,
      });
      expect(metadata.title).toBeTruthy();
      titles.add(metadata.title);
      expect(metadata.description).toBeTruthy();
      descriptions.add(metadata.description ?? "");

      const switcher = page.locator(".language-switcher");
      const summary = switcher.locator("summary");
      const languageLabel = await switcher
        .locator("ul")
        .getAttribute("aria-label");
      await expect(summary).toHaveText(code);
      await expect(summary).toHaveAccessibleName(`${languageLabel} (${code})`);
      await expect(summary).toHaveCSS("cursor", "default");
      await summary.press("Enter");
      await expect(switcher.getByRole("link")).toHaveCount(languages.length);
      await expect(switcher.locator('[aria-current="page"]')).toHaveAttribute(
        "href",
        path,
      );
      const commands = await page
        .locator(".step-list pre code")
        .allTextContents();
      expect(commands).toEqual(expectedCommands);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `Full page width for ${code}`,
      ).toBeLessThanOrEqual(320);
      const overflowingLabels = await page
        .locator(".chapter-label")
        .evaluateAll((labels) =>
          labels
            .filter((label) => label.scrollWidth > label.clientWidth)
            .map((label) => label.textContent),
        );
      expect(overflowingLabels, `Chapter labels for ${code}`).toEqual([]);
    }
    expect(titles.size).toBe(languages.length);
    expect(descriptions.size).toBe(languages.length);
    const sitemap = await page.goto(new URL("sitemap.xml", landingUrl).href);
    const entries = (await sitemap?.text())?.matchAll(/<loc>([^<]+)<\/loc>/g);
    expect(Array.from(entries ?? [], ([, url]) => url)).toEqual(canonicals);
  });
});

test.describe("language switcher with a mouse", () => {
  test.use({ hasTouch: false });

  test("the globe rotates on its tilted axis and respects reduced motion", async ({
    page,
  }) => {
    await page.route("**/room-preview.js", (route) => route.abort());
    const motionReady = Promise.withResolvers<void>();
    await page.route("**/landing-motion.js", async (route) => {
      await motionReady.promise;
      await route.fallback();
    });
    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
    const summary = page.locator(".language-switcher summary");
    const globe = summary.locator("svg");
    await expect(globe).toBeVisible();
    await expect(globe).toHaveCSS("animation-name", "none");
    const meridianWidths = await globe
      .locator(".globe-meridian")
      .evaluateAll((meridians) =>
        meridians
          .map((meridian) => getComputedStyle(meridian))
          .filter((style) => Number(style.opacity) > 0.1)
          .map((style) => new DOMMatrix(style.transform).a)
          .toSorted((left, right) => left - right),
      );
    expect(meridianWidths).toHaveLength(3);
    expect(meridianWidths.at(0)).toBeLessThan(-0.25);
    expect(meridianWidths.at(1)).toBeCloseTo(0, 2);
    expect(meridianWidths.at(1)).not.toBe(0);
    expect(meridianWidths.at(2)).toBeGreaterThan(0.25);

    const initial = await globe.evaluate((icon) => ({
      meridian: getComputedStyle(icon.querySelector(".globe-meridian") ?? icon)
        .transform,
      equator: icon.querySelector("g > path")?.getBoundingClientRect().toJSON(),
    }));
    expect(initial.equator?.height).toBeGreaterThan(0);
    const readAngle = () =>
      globe.evaluate((icon) =>
        Number.parseFloat(
          getComputedStyle(icon).getPropertyValue("--globe-turn"),
        ),
      );

    await summary.hover();
    motionReady.resolve();
    await expect
      .poll(async () => {
        const angle = await readAngle();
        return angle > 1 && angle < 359;
      })
      .toBe(true);
    const during = await globe.evaluate((icon) => ({
      meridian: getComputedStyle(icon.querySelector(".globe-meridian") ?? icon)
        .transform,
      equator: icon.querySelector("g > path")?.getBoundingClientRect().toJSON(),
      transform: getComputedStyle(icon).transform,
    }));
    expect(during.meridian).not.toBe(initial.meridian);
    expect(during.equator).toEqual(initial.equator);
    expect(during.transform).toBe("none");

    await page.mouse.move(0, 0);
    await expect.poll(readAngle).toBeCloseTo(360, 0);

    await summary.hover();
    await expect.poll(readAngle).toBeLessThan(360);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(readAngle).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(await readAngle()).toBe(0);
  });
});

test("the language switcher preserves shared anchors with the keyboard and touch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const switcher = page.locator(".language-switcher");
  const language = switcher.locator("summary");

  await page.goto(`${landingUrl}#remote`);
  await language.press("Enter");
  await page.keyboard.press("Tab");
  await expect(switcher.getByRole("link", { name: "English" })).toBeFocused();
  await page.keyboard.press("Tab");
  const chinese = switcher.getByRole("link", { name: "简体中文" });
  await expect(chinese).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chinese).toBeHidden();
  await expect(language).toBeFocused();
  await language.press("Enter");
  await chinese.press("Enter");
  await expect(page).toHaveURL(`${landingUrl}zh-Hans/#remote`);
  await expect(page.locator("#remote-title")).toHaveText("远程使用 Roomkit");

  await page.getByRole("link", { name: /快照与渲染/ }).tap();
  await expect(page.locator("#render-room")).toBeVisible();
  await expect(page.locator("#walk-room")).toBeHidden();
  const comparison = page.getByRole("slider", { name: /对比 Roomkit 快照/ });
  await comparison.press("ArrowRight");
  await expect(comparison).toHaveAttribute(
    "aria-valuetext",
    "快照 51%，渲染图 49%",
  );
  await language.tap();
  await switcher.getByRole("link", { name: "English" }).tap();
  await expect(page).toHaveURL(`${landingUrl}#render-room`);
  await expect(page.locator("#render-room")).toBeVisible();

  await page.goto(`${landingUrl}#render%2Droom`);
  await expect(page.locator("#render-room")).toBeVisible();
  await language.press("Enter");
  await chinese.press("Enter");
  await expect(page).toHaveURL(`${landingUrl}zh-Hans/#render%2Droom`);
  await expect(page.locator("#render-room")).toBeVisible();

  for (const fragment of ["#unavailable", "#invalid%"]) {
    await page.goto(`${landingUrl}${fragment}`);
    await language.press("Enter");
    await chinese.press("Enter");
    await expect(page).toHaveURL(`${landingUrl}zh-Hans/`);
  }
});

test("Simplified Chinese uses the interactive hero and copies verbatim commands", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${landingUrl}zh-Hans/`);
  await expect(page).toHaveTitle("Roomkit — Mac 版 3D 房间设计工具");
  const canvas = page.locator("#room-preview[data-ready] canvas");
  await expect(canvas).toHaveAccessibleName(/可交互的 3D 客厅/);
  await expect(canvas).toBeVisible();

  for (const command of ["pnpm daemon", "sh scripts/tailnet-serve.sh off"]) {
    const copy = page.getByRole("button", {
      name: `复制命令：${command}`,
      exact: true,
    });
    await copy.click();
    await expect(copy.locator("..").getByRole("status")).toHaveText(
      "命令已复制",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      command,
    );
  }
});
