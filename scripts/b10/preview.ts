import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { serveInspectPage } from "../b4/serve-inspect-page.ts";

const [glb, output, mount, azimuth, elevation, environment] =
  process.argv.slice(2);
if (!glb || !output || !mount)
  throw new Error("Expected GLB, output, mount and angles");
const server = await serveInspectPage({
  roots: {
    here: resolve("blender/procedural"),
    three: resolve("node_modules/three"),
    model: dirname(resolve(glb)),
  },
});
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu"],
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`${server.baseUrl}/here/preview.html`);
  await page.waitForFunction("window.previewReady === true");
  await page.evaluate(
    `window.renderPreview(${JSON.stringify({
      url: `${server.baseUrl}/model/${encodeURIComponent(glb.split("/").at(-1) ?? "raw.glb")}`,
      mount,
      environment: environment === "true",
      azimuthDeg: Number(azimuth ?? 30),
      elevationDeg: Number(elevation ?? 20),
      zoomOut: 1.05,
      widthPx: 900,
      heightPx: 900,
    })})`,
  );
  await page.locator("canvas").screenshot({ path: output });
} finally {
  await browser.close();
  await server.close();
}
