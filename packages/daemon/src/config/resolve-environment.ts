import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveEnvironment(env: {
  [name: string]: string | undefined;
}) {
  const homeDir = resolve(env.HOME || homedir());
  const hasPlannerHome = env.PLANNER_HOME !== undefined;
  const hasProjectsRoot = env.PLANNER_PROJECTS !== undefined;
  if (hasProjectsRoot !== hasPlannerHome) {
    throw new Error(
      "Set both PLANNER_HOME and PLANNER_PROJECTS to isolate daemon storage",
    );
  }
  function expand(path: string) {
    if (!path.trim()) throw new Error("Storage paths must not be empty");
    return resolve(
      path === "~"
        ? homeDir
        : path.startsWith("~/")
          ? join(homeDir, path.slice(2))
          : path,
    );
  }
  const port = Number(env.PLANNER_PORT ?? "4820");
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    env.PLANNER_PORT === ""
  ) {
    throw new Error("PLANNER_PORT must be an integer from 0 to 65535");
  }
  const webOrigins = (
    env.PLANNER_WEB_ORIGIN ?? "http://localhost:3210,http://127.0.0.1:3210"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (
    webOrigins.length === 0 ||
    webOrigins.some(
      (origin) => !URL.canParse(origin) || new URL(origin).origin !== origin,
    )
  )
    throw new Error(
      "PLANNER_WEB_ORIGIN must list origins like http://host:port",
    );
  const writeDelayMs = Number(env.PLANNER_WRITE_DELAY_MS ?? "500");
  if (
    !Number.isInteger(writeDelayMs) ||
    writeDelayMs < 0 ||
    writeDelayMs > 2_147_483_647 ||
    env.PLANNER_WRITE_DELAY_MS?.trim() === ""
  )
    throw new Error(
      "PLANNER_WRITE_DELAY_MS must be an integer from 0 to 2147483647",
    );
  const linkAllowedHosts = (env.PLANNER_LINK_ALLOW_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  const allowedHosts = (env.PLANNER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  const tailnetLogins = (env.PLANNER_TAILNET_LOGINS ?? "")
    .split(",")
    .map((login) => login.trim())
    .filter((login) => login.length > 0);
  if (
    allowedHosts.some(
      (host) =>
        host.includes("*") ||
        !URL.canParse(`http://${host}`) ||
        new URL(`http://${host}`).host !== host.replace(/:80$/, ""),
    )
  )
    throw new Error("PLANNER_ALLOWED_HOSTS must list hosts like host:port");
  return {
    allowedHosts,
    tailnetLogins,
    homeDir,
    linkAllowedHosts,
    modelRegistryPath: env.PLANNER_MODEL_REGISTRY || undefined,
    weightsBaseUrl: env.PLANNER_WEIGHTS_BASE_URL || undefined,
    writeDelayMs,
    plannerHome: expand(env.PLANNER_HOME ?? "~/.interior-planner"),
    projectsRoot: expand(env.PLANNER_PROJECTS ?? "~/InteriorPlanner/projects"),
    port,
    webOrigins,
  };
}

export type Environment = ReturnType<typeof resolveEnvironment>;
