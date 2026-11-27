import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No free port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return String(address.port);
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "packages/daemon/src/objects/object-sources.test.ts",
    "packages/daemon/src/objects/object-library-review.test.ts",
    "packages/daemon/src/http/crop-cache.test.ts",
  ],
  {
    env: {
      ...process.env,
      PLANNER_PORT: await freePort(),
      PLANNER_WEB_PORT: await freePort(),
    },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(
  "gate:b16 passed: source views, JPEG crops and cache, saved web copies, object library, archive and restore\n",
);
