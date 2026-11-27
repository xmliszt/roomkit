import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModelRegistry } from "../../../../../packages/daemon/src/preflight/read-model-registry.ts";

const root = process.env.PLANNER_E2E_HOME;
if (!root) throw new Error("PLANNER_E2E_HOME is required");
mkdirSync(root, { recursive: true });
const registry = readModelRegistry(undefined);
registry.models = registry.models.map((model) => ({
  ...model,
  files: [{ path: "fixture.safetensors", sizeBytes: 4 }],
}));
const registryPath = join(root, "registry.json");
writeFileSync(registryPath, JSON.stringify(registry));
for (const model of registry.models) {
  const folder = join(root, "home", "python", "weights", model.folder);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "fixture.safetensors"), "data");
}
writeFileSync(join(root, "control.json"), JSON.stringify({ mode: "normal" }));
const daemon = spawn(process.execPath, ["packages/daemon/src/main.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
    PLANNER_PYTHON_BIN: resolve("scripts/b6/fake-python.mjs"),
    PLANNER_MODEL_REGISTRY: registryPath,
    PLANNER_BREW_BIN: join(root, "missing-brew"),
    PLANNER_UV_BIN: join(root, "missing-uv"),
    BLENDER: join(root, "missing-blender"),
    B6_CONTROL: join(root, "control.json"),
    B6_CALLS: join(root, "calls.jsonl"),
  },
});
process.once("SIGTERM", () => daemon.kill("SIGTERM"));
process.once("SIGINT", () => daemon.kill("SIGINT"));
daemon.once("error", (error) => {
  throw error;
});
daemon.once("exit", (code) => {
  process.exitCode = code ?? 0;
});
