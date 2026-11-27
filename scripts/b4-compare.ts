// Render every charging port type in three.js beside a reference photo and save one PNG.
// Usage: node scripts/b4-compare.ts <photo folder with <typeId>.jpg|png|webp> <output.png>
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { chromium } from "@playwright/test";
import { serveInspectPage } from "./b4/serve-inspect-page.ts";

declare global {
  interface Window {
    inspectReady?: boolean;
    renderGlb: (options: {
      url: string;
      sizeM: { width: number; height: number; depth: number };
      sizePx: number;
    }) => Promise<string>;
  }
}

const RENDER_SIZE_PX = 480;
const [photoArgument, outputArgument] = process.argv.slice(2);
if (!photoArgument || !outputArgument)
  throw new Error(
    "Usage: node scripts/b4-compare.ts <photo folder> <output.png>",
  );
const photoFolder = resolve(photoArgument);
const root = resolve(import.meta.dirname, "..");
const server = await serveInspectPage({
  roots: {
    page: join(root, "scripts/b4"),
    three: join(root, "node_modules/three"),
    catalog: join(root, "packages/daemon/catalog"),
    photos: photoFolder,
  },
});
const browser = await chromium
  .launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    timeout: 30_000,
  })
  .catch(async (error: unknown) => {
    await server.close();
    throw error;
  });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  await page.goto(`${server.baseUrl}/page/inspect.html`);
  await page.waitForFunction(() => window.inspectReady === true);
  const rows = [];
  for (const entry of CHARGING_PORT_TYPES) {
    const render = await page.evaluate((options) => window.renderGlb(options), {
      url: `/catalog/${entry.assetId}/model.glb`,
      sizeM: entry.sizeM,
      sizePx: RENDER_SIZE_PX,
    });
    const photo = ["jpg", "jpeg", "png", "webp"]
      .map((extension) => `${entry.typeId}.${extension}`)
      .find((name) => existsSync(join(photoFolder, name)));
    rows.push({ label: entry.label, render, photo });
  }
  await page.evaluate(
    (options) => {
      document.body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,${options.sizePx}px);gap:16px 16px;padding:16px">${options.rows
        .map(
          (row) =>
            `<div style="grid-column:1/3;font-weight:600">${row.label}</div><img src="${row.render}" width="${options.sizePx}" height="${options.sizePx}"><div style="width:${options.sizePx}px;height:${options.sizePx}px;display:grid;place-items:center;background:#f4f4f4">${row.photo ? `<img src="/photos/${row.photo}" style="max-width:100%;max-height:100%">` : "no reference photo"}</div>`,
        )
        .join("")}</div>`;
    },
    { rows, sizePx: RENDER_SIZE_PX },
  );
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete),
  );
  await page.screenshot({ path: resolve(outputArgument), fullPage: true });
  console.log(`saved ${resolve(outputArgument)}`);
} finally {
  await browser.close();
  await server.close();
}
