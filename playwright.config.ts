import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { createConfigStore } from "./packages/daemon/src/config/create-config-store.ts";

const webPort = Number(process.env.PLANNER_WEB_PORT ?? "3210");
const daemonPort = Number(process.env.PLANNER_PORT ?? "4820");
process.env.PLANNER_E2E_HOME ??= mkdtempSync(join(tmpdir(), "planner-e2e-"));
const e2eHome = process.env.PLANNER_E2E_HOME;
const plannerHome = join(e2eHome, "home");
createConfigStore({ plannerHome });

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: "node packages/daemon/src/main.ts",
      url: `http://127.0.0.1:${daemonPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PLANNER_HOME: plannerHome,
        PLANNER_PROJECTS: join(e2eHome, "projects"),
        PLANNER_PORT: String(daemonPort),
        PLANNER_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
        PLANNER_WRITE_DELAY_MS: "50",
        PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
        PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
        BLENDER: join(e2eHome, "tools", "blender"),
      },
    },
    {
      command: `pnpm -F @planner/web exec next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PLANNER_PORT: String(daemonPort) },
    },
  ],
});
