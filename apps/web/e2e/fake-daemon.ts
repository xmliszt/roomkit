import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDaemon } from "../../../packages/daemon/src/create-daemon.ts";

const root = process.env.PLANNER_E2E_HOME;
if (!root) throw new Error("PLANNER_E2E_HOME is required");
const claudeConfig = join(root, "claude");
const codexConfig = join(root, "codex");
const toolsBin = join(root, "tools");
const claudeBin = join(toolsBin, "claude");
for (const folder of [claudeConfig, codexConfig, toolsBin])
  mkdirSync(folder, { recursive: true });
const claudeSource = pathToFileURL(resolve("test/fake-cli/claude")).href;
writeFileSync(
  claudeBin,
  `#!/usr/bin/env node\nawait import(${JSON.stringify(claudeSource)});\n`,
  { mode: 0o755 },
);
writeFileSync(
  join(claudeConfig, ".credentials.json"),
  JSON.stringify({
    claudeAiOauth: {
      accessToken: "fake-token",
      scopes: ["user:profile"],
      subscriptionType: "max",
    },
  }),
);
writeFileSync(
  join(codexConfig, "auth.json"),
  JSON.stringify({ tokens: { access_token: "fake-token" } }),
);
const weights = Buffer.from("fake weights for the browser gate");
const registryPath = join(root, "registry.json");
writeFileSync(
  registryPath,
  JSON.stringify({
    baseUrl: "https://weights.example.test",
    models: [
      { id: "fixture-model", name: "Fixture model" },
      { id: "map-anything", name: "MapAnything" },
      { id: "sam3-mlx", name: "SAM 3" },
    ].map(({ id, name }) => ({
      id,
      name,
      folder: id,
      repo: "fixture/model",
      revision: "revision-1",
      files: [
        {
          path: "model.safetensors",
          sizeBytes: weights.length,
          sha256: createHash("sha256").update(weights).digest("hex"),
        },
      ],
    })),
  }),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://api.anthropic.com/api/oauth/usage")
    return Response.json({
      limits: [
        { kind: "session", percent: 24, resets_at: "2026-11-24T03:00:00Z" },
        { kind: "weekly_all", percent: 41, resets_at: "2026-11-29T00:00:00Z" },
      ],
    });
  if (url === "https://chatgpt.com/backend-api/wham/usage")
    return Response.json({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 17,
          limit_window_seconds: 18000,
          reset_at: 1795489200,
        },
        secondary_window: {
          used_percent: 33,
          limit_window_seconds: 604800,
          reset_at: 1795996800,
        },
      },
    });
  if (url.startsWith("https://weights.example.test/"))
    return new Response(weights);
  return originalFetch(input, init);
};
const daemon = createDaemon({
  env: {
    ...process.env,
    PLANNER_MACHINE_LOCK: join(root, "machine.lock"),
    CLAUDE_CONFIG_DIR: claudeConfig,
    CODEX_HOME: codexConfig,
    PLANNER_CLAUDE_BIN: claudeBin,
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
    PLANNER_FAKE_SCENARIO: "move-charging-port",
    PLANNER_BREW_BIN: resolve("test/fake-tools/brew"),
    PLANNER_UV_BIN: join(root, "tools", "uv"),
    BLENDER: join(root, "tools", "blender"),
    FAKE_TOOLS_BIN: toolsBin,
    PLANNER_MODEL_REGISTRY: registryPath,
  },
});
await daemon.listen();
process.stdout.write("A5 fixture daemon ready\n");
async function shutdown() {
  await daemon.close();
  globalThis.fetch = originalFetch;
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
