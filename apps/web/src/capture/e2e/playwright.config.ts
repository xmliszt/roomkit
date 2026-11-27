import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config.ts";

const root = resolve(import.meta.dirname, "../../../../..");
const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testDir: import.meta.dirname,
  timeout: 60000,
  use: { ...base.use, actionTimeout: 5000, screenshot: "only-on-failure" },
  projects: [{ name: "capture", testMatch: "*.gate.ts" }],
  webServer: servers.map((server, index) => ({
    ...server,
    cwd: root,
    ...(index === 0
      ? { command: "node apps/web/src/capture/e2e/fake-daemon.ts" }
      : {}),
  })),
});
