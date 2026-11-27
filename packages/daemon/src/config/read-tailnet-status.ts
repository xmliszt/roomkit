import type { TailnetStatus } from "@planner/shared/src/protocol/tailnet-status-schema.ts";
import { z } from "zod";
import { createTailscaleCli } from "./create-tailscale-cli.ts";
import type { Environment } from "./resolve-environment.ts";

const nodeStatus = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string().optional() }).nullish(),
});
const serveStatus = z.object({
  TCP: z
    .record(z.string(), z.object({ HTTPS: z.boolean().optional() }))
    .optional(),
  Web: z
    .record(
      z.string(),
      z.object({
        Handlers: z.record(
          z.string(),
          z.object({ Proxy: z.string().optional() }),
        ),
      }),
    )
    .optional(),
  AllowFunnel: z.record(z.string(), z.boolean()).optional(),
});

export async function readTailnetStatus(options: {
  env: NodeJS.ProcessEnv;
  environment: Environment;
}): Promise<TailnetStatus> {
  const cli = createTailscaleCli({ env: options.env });
  try {
    const status = await cli(["status", "--json", "--peers=false"]);
    const node = nodeStatus.parse(JSON.parse(status));
    const dns = node.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
    if (node.BackendState !== "Running") return { kind: "disconnected" };
    if (!dns) return { kind: "needs-dns" };
    if (!/^(?:[a-z0-9-]+\.)+ts\.net$/.test(dns)) return { kind: "unavailable" };

    const host = `${dns}:8443`;
    const serve = await cli(["serve", "status", "--json"]);
    const config = serveStatus.parse(JSON.parse(serve.trim() || "{}") ?? {});
    if (config.AllowFunnel?.[host]) return { kind: "public", host };
    const handlers = config.Web?.[host]?.Handlers;
    if (
      config.TCP?.["8443"]?.HTTPS !== true ||
      handlers?.["/"]?.Proxy !== "http://127.0.0.1:3210" ||
      handlers["/daemon"]?.Proxy !==
        `http://127.0.0.1:${options.environment.port}`
    )
      return { kind: "serve-not-configured", host };
    if (
      !options.environment.allowedHosts.includes(host) ||
      !options.environment.webOrigins.includes(`https://${host}`) ||
      options.environment.tailnetLogins.length === 0
    )
      return { kind: "roomkit-not-configured", host };
    return { kind: "ready", host };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { kind: "cli-missing" };
    return { kind: "unavailable" };
  }
}
