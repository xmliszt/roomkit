import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { daemonPort, tailnetPort, webPort } from "./ports.mjs";
import { createDaemon } from "./runtime/packages/daemon/src/create-daemon.ts";

const host = "127.0.0.1";
const origin = `http://${host}:${webPort}`;
const launcherPid = process.ppid;
const controller = new AbortController();
const defaultHome = join(
  homedir(),
  "Library",
  "Application Support",
  "Roomkit",
);
const env = {
  ...process.env,
  PATH: [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  ].join(":"),
  NODE_ENV: "production",
  ROOMKIT_DESKTOP: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  ...(!process.env.PLANNER_HOME && !process.env.PLANNER_PROJECTS
    ? {
        PLANNER_HOME: defaultHome,
        PLANNER_PROJECTS: join(defaultHome, "Projects"),
      }
    : {}),
  PLANNER_PORT: String(daemonPort),
  PLANNER_WEB_ORIGIN: origin,
  PLANNER_ALLOWED_HOSTS: "",
  PLANNER_TAILNET_LOGINS: "",
};
const daemon = createDaemon({
  env,
  desktopTailnet: { webPort, servePort: tailnetPort },
});
let web;

async function stop() {
  if (controller.signal.aborted) return;
  controller.abort();
  const watchdog = setTimeout(() => {
    if (web?.exitCode === null && web.signalCode === null) web.kill("SIGKILL");
    process.exit(1);
  }, 8000);
  watchdog.unref();
  const webExited =
    web?.exitCode === null && web.signalCode === null
      ? once(web, "close").catch(() => undefined)
      : undefined;
  if (webExited) web.kill("SIGTERM");
  await Promise.allSettled([webExited, daemon.close()]);
  clearTimeout(watchdog);
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.once(signal, () => void stop());
setInterval(() => {
  if (process.ppid !== launcherPid) void stop();
}, 1000).unref();

async function checkWebPort() {
  const server = createServer();
  try {
    server.listen(webPort, host);
    await once(server, "listening");
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    if (error?.code === "EADDRINUSE")
      throw new Error(
        `Roomkit needs port ${webPort}. Close the process using it and reopen Roomkit.`,
      );
    throw error;
  }
}

async function waitForWeb() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted();
    const response = await fetch(origin, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]),
    }).catch(() => undefined);
    if (response) {
      await response.body?.cancel();
      if (response.ok && web.exitCode === null) return;
    }
    await delay(200, undefined, { signal: controller.signal });
  }
  throw new Error("Roomkit's editor did not start within 30 seconds.");
}

try {
  await checkWebPort();
  await daemon.listen();
  controller.signal.throwIfAborted();
  web = spawn(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./watch-parent.mjs", import.meta.url)),
      fileURLToPath(new URL("./web/apps/web/server.js", import.meta.url)),
    ],
    {
      env: {
        ...env,
        HOSTNAME: host,
        PORT: String(webPort),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", 2, 2],
    },
  );
  web.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    void stop();
  });
  web.once("exit", () => {
    if (controller.signal.aborted) return;
    process.exitCode = 1;
    void stop();
  });
  await waitForWeb();
  if (!controller.signal.aborted)
    process.stdout.write(`ROOMKIT_READY ${origin}\n`);
} catch (error) {
  if (!controller.signal.aborted) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    await stop();
  }
}
