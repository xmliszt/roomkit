import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return String(address.port);
}

const daemonPort = await freePort();
const webPort = await freePort();
if (
  daemonPort === webPort ||
  [daemonPort, webPort].some((port) => ["3210", "4820"].includes(port))
)
  throw new Error("Retry with separate free ports");
const env = {
  ...process.env,
  PLANNER_PORT: daemonPort,
  PLANNER_WEB_PORT: webPort,
};
function run(args: string[]) {
  process.stdout.write(`pnpm ${args.join(" ")}\n`);
  const result = spawnSync("pnpm", args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const base = execFileSync("git", ["merge-base", "HEAD", "orchestrator"], {
  encoding: "utf8",
}).trim();
const changed = execFileSync("git", ["diff", "--name-only", base], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((path) => /\.(tsx?|css)$/.test(path));
run(["typecheck"]);
run(["exec", "biome", "check", ...changed]);
const playwright = [
  "exec",
  "playwright",
  "test",
  "-c",
  "apps/web/playwright.config.ts",
  "--no-deps",
];
run([
  ...playwright,
  "--project=chromium-a5",
  "apps/web/e2e/stacking.spec.ts",
  "apps/web/e2e/object-context-menu.spec.ts",
  "apps/web/e2e/charging-port-type.spec.ts",
  "apps/web/e2e/chat-object-refs.spec.ts",
]);
run([
  ...playwright,
  "--project=chromium-a5",
  "apps/web/e2e/objects-panel.spec.ts",
  "--grep",
  "picker",
]);
run([
  ...playwright,
  "--project=chromium-earlier",
  "e2e/advanced-panel.spec.ts",
  "e2e/editor-shell.spec.ts",
  "--grep",
  "advanced panel|tool keys",
]);
process.stdout.write(
  "A30 gate passed: typecheck, biome, stacking and existing menu checks.\n",
);
