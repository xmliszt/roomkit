import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { daemonPort } from "../../desktop/ports.mjs";

const standalone = process.env.ROOMKIT_DESKTOP_BUILD === "1";
const nextConfig: NextConfig = {
  ...(standalone
    ? {
        output: "standalone",
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  transpilePackages: ["@planner/shared"],
  devIndicators: false,
  allowedDevOrigins: (process.env.PLANNER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().replace(/:\d+$/, ""))
    .filter((host) => host !== ""),
  env: {
    NEXT_PUBLIC_ROOMKIT_DESKTOP: standalone ? "1" : "0",
    NEXT_PUBLIC_PLANNER_PORT: standalone
      ? String(daemonPort)
      : (process.env.PLANNER_PORT ?? "4820"),
  },
};

export default nextConfig;
