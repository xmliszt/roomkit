import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config.ts";

const root = resolve(import.meta.dirname, "../..");
const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testDir: root,
  use: {
    ...base.use,
    ...(process.env.PLANNER_BROWSER_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.PLANNER_BROWSER_EXECUTABLE,
          },
        }
      : {}),
    ...(process.env.PLANNER_BROWSER_CHANNEL
      ? { channel: process.env.PLANNER_BROWSER_CHANNEL }
      : {}),
  },
  projects: [
    {
      ...base.projects?.at(0),
      name: "chromium-earlier",
      testMatch: "e2e/*.spec.ts",
      testIgnore: "apps/web/e2e/*.spec.ts",
    },
    {
      ...base.projects?.at(0),
      name: "chromium-a5",
      testMatch: "apps/web/e2e/*.spec.ts",
      dependencies: ["chromium-earlier"],
    },
  ],
  globalTeardown: resolve(root, "e2e/global-teardown.ts"),
  outputDir: process.env.PLANNER_EVIDENCE_DIR
    ? resolve(process.env.PLANNER_EVIDENCE_DIR, "test-results")
    : "/tmp/planner-a5-results",
  webServer: servers.map((server, index) => ({
    ...server,
    cwd: root,
    ...(index === 0 ? { command: "node apps/web/e2e/fake-daemon.ts" } : {}),
  })),
});
