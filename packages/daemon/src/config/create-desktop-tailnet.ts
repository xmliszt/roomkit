import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TailnetLoginSchema } from "@planner/shared/src/protocol/tailnet-login-schema.ts";
import type { DesktopTailnetStatus } from "@planner/shared/src/protocol/tailnet-status-schema.ts";
import { z } from "zod";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import { writeJson } from "../util/write-json.ts";
import { createTailscaleCli } from "./create-tailscale-cli.ts";
import type { Environment } from "./resolve-environment.ts";

const dnsPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/;
const savedAccessSchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(false),
    host: z.string().optional(),
    logins: z.array(TailnetLoginSchema).max(50),
  }),
  z.object({
    enabled: z.literal(true),
    host: z.string(),
    logins: z.array(TailnetLoginSchema).min(1).max(50),
  }),
]);
type SavedAccess = z.infer<typeof savedAccessSchema>;

const nodeStatus = z.object({
  BackendState: z.string(),
  Self: z
    .object({
      DNSName: z.string().optional(),
      UserID: z.union([z.number(), z.string()]).optional(),
    })
    .nullish(),
  CurrentTailnet: z.object({ MagicDNSEnabled: z.boolean() }).nullish(),
  CertDomains: z.array(z.string()).nullish(),
  User: z.record(z.string(), z.object({ LoginName: z.string() })).nullish(),
});
const listeners = z.record(
  z.string(),
  z.object({ HTTPS: z.boolean().optional() }),
);
const serveStatus = z.object({
  TCP: listeners.optional(),
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
  Foreground: z
    .record(z.string(), z.object({ TCP: listeners.optional() }))
    .optional(),
});
type ServeStatus = z.infer<typeof serveStatus>;

const prerequisiteMessages = {
  "cli-missing": "Install Tailscale on this Mac and sign in.",
  unavailable:
    "Open Tailscale on this Mac and check that it is running, then try again.",
  disconnected: "Open Tailscale on this Mac and sign in or connect.",
  "needs-dns": "Ask your Tailscale admin to turn on MagicDNS.",
  "needs-https": "Ask your Tailscale admin to enable HTTPS certificates.",
} satisfies Partial<{ [state in DesktopTailnetStatus["state"]]: string }>;

type NodeInspection =
  | { kind: keyof typeof prerequisiteMessages }
  | {
      kind: "connected";
      host: string;
      magicDns: boolean;
      https: boolean;
      login: string | undefined;
    };

export function createDesktopTailnet(options: {
  env: NodeJS.ProcessEnv;
  environment: Environment;
  webPort: number;
  servePort: number;
  executable?: string;
  onAccessChange: () => void;
}) {
  const cli = createTailscaleCli({
    env: options.env,
    packaged: true,
    ...(options.executable && { executable: options.executable }),
  });
  const path = join(options.environment.plannerHome, "tailnet.json");
  const port = String(options.servePort);
  const routes = [
    {
      mount: "/daemon",
      target: `http://127.0.0.1:${options.environment.port}`,
    },
    { mount: "/", target: `http://127.0.0.1:${options.webPort}` },
  ];
  let saved: SavedAccess = { enabled: false, logins: [] };
  let isChanging = false;
  try {
    const current = savedAccessSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (
      current.host === undefined ||
      (current.host.endsWith(`:${port}`) &&
        dnsPattern.test(current.host.split(":")[0] ?? ""))
    )
      saved = current;
  } catch (error) {
    if (
      !isMissingPathError(error) &&
      !(error instanceof SyntaxError) &&
      !(error instanceof z.ZodError)
    )
      throw error;
  }

  function save(value: SavedAccess) {
    writeJson({ path, value });
    saved = value;
  }

  async function inspectNode(): Promise<NodeInspection> {
    try {
      const node = nodeStatus.parse(
        JSON.parse(await cli(["status", "--json", "--peers=false"])),
      );
      if (node.BackendState !== "Running") return { kind: "disconnected" };
      const dns = node.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
      if (!dns || !dnsPattern.test(dns)) return { kind: "needs-dns" };
      const login = TailnetLoginSchema.safeParse(
        node.User?.[String(node.Self?.UserID)]?.LoginName,
      );
      return {
        kind: "connected",
        host: `${dns}:${port}`,
        magicDns: node.CurrentTailnet?.MagicDNSEnabled === true,
        https:
          node.CertDomains?.some((domain) => domain.toLowerCase() === dns) ===
          true,
        login: login.success ? login.data : undefined,
      };
    } catch (error) {
      return {
        kind: isMissingPathError(error) ? "cli-missing" : "unavailable",
      };
    }
  }

  async function inspectServe() {
    try {
      const output = await cli(["serve", "status", "--json"]);
      return serveStatus.parse(JSON.parse(output.trim() || "{}") ?? {});
    } catch {
      throw new Error(prerequisiteMessages.unavailable);
    }
  }

  function hasForeignHost(config: ServeStatus, host: string) {
    return Object.keys(config.Web ?? {}).some(
      (key) => key.endsWith(`:${port}`) && key !== host,
    );
  }

  function hasConflict(config: ServeStatus, host: string) {
    const listener = config.TCP?.[port];
    const handlers = config.Web?.[host]?.Handlers ?? {};
    return (
      (listener !== undefined && listener.HTTPS !== true) ||
      Object.values(config.Foreground ?? {}).some(
        (service) => service.TCP?.[port] !== undefined,
      ) ||
      hasForeignHost(config, host) ||
      config.AllowFunnel?.[host] === true ||
      Object.entries(handlers).some(
        ([mount, handler]) =>
          !routes.some(
            (route) => route.mount === mount && route.target === handler.Proxy,
          ),
      )
    );
  }

  function routesReady(config: ServeStatus, host: string) {
    return (
      config.TCP?.[port]?.HTTPS === true &&
      routes.every(
        ({ mount, target }) =>
          config.Web?.[host]?.Handlers[mount]?.Proxy === target,
      )
    );
  }

  function updateServeRoute(input: { mount: string; target: string }) {
    return cli([
      "serve",
      "--bg",
      "--yes",
      `--https=${port}`,
      `--set-path=${input.mount}`,
      input.target,
    ]);
  }

  async function removeRoutes(host: string) {
    for (const { mount, target } of routes) {
      const config = await inspectServe();
      const handlers = config.Web?.[host]?.Handlers ?? {};
      if (handlers[mount]?.Proxy !== target) continue;
      if (hasForeignHost(config, host) && Object.keys(handlers).length === 1)
        throw new Error(
          `Tailscale is sharing HTTPS port ${port} with another host. Clear the conflict before removing Roomkit’s route.`,
        );
      try {
        await updateServeRoute({ mount, target: "off" });
      } catch {
        throw new Error(
          "Roomkit stopped accepting remote connections. Reconnect Tailscale and try removing the remaining Serve routes again.",
        );
      }
    }
    const config = await inspectServe();
    if (
      routes.some(
        ({ mount, target }) =>
          config.Web?.[host]?.Handlers[mount]?.Proxy === target,
      )
    )
      throw new Error(
        "Roomkit stopped accepting remote connections. Try removing the remaining Serve routes again.",
      );
  }

  async function status(): Promise<DesktopTailnetStatus> {
    const node = await inspectNode();
    const config =
      node.kind === "connected" && node.magicDns && node.https
        ? await inspectServe().catch(() => undefined)
        : undefined;
    const current = saved;
    const result: Omit<DesktopTailnetStatus, "state"> = {
      kind: "desktop",
      canDisable: current.host !== undefined,
      logins:
        current.logins.length || node.kind !== "connected" || !node.login
          ? current.logins
          : [node.login],
    };
    if (node.kind !== "connected") return { ...result, state: node.kind };
    if (current.host && current.host !== node.host)
      return { ...result, state: "account-changed" };
    if (!node.magicDns) return { ...result, state: "needs-dns" };
    if (!node.https) return { ...result, state: "needs-https" };
    if (!config) return { ...result, state: "unavailable" };
    if (hasConflict(config, node.host)) return { ...result, state: "conflict" };
    if (!current.enabled)
      return {
        ...result,
        state: current.host ? "cleanup-pending" : "disabled",
      };
    if (!routesReady(config, node.host))
      return { ...result, state: "routes-missing" };
    return { ...result, state: "ready", url: `https://${node.host}` };
  }

  return {
    access() {
      return saved.enabled ? saved : undefined;
    },
    status,
    async enable(logins: string[]) {
      if (isChanging)
        throw new Error("Roomkit is already updating remote access.");
      isChanging = true;
      try {
        const node = await inspectNode();
        if (node.kind !== "connected")
          throw new Error(prerequisiteMessages[node.kind]);
        if (saved.host && saved.host !== node.host)
          throw new Error(
            "Switch Tailscale back to the account and device name that enabled Roomkit, then disable remote access there first.",
          );
        if (!node.magicDns) throw new Error(prerequisiteMessages["needs-dns"]);
        if (!node.https) throw new Error(prerequisiteMessages["needs-https"]);
        let config = await inspectServe();
        if (hasConflict(config, node.host))
          throw new Error(
            `Another Tailscale route is using HTTPS port ${port}. Move that route to a different port, then try again.`,
          );
        const selected = [...new Set(logins)];
        if (!routesReady(config, node.host)) {
          save({ enabled: false, host: node.host, logins: selected });
          options.onAccessChange();
        }
        for (const { mount, target } of routes) {
          if (config.Web?.[node.host]?.Handlers[mount]?.Proxy === target)
            continue;
          try {
            await updateServeRoute({ mount, target });
          } catch {
            throw new Error(
              "Tailscale could not set up Roomkit’s route. Open Tailscale on this Mac, check that Serve is permitted, then try again.",
            );
          }
          config = await inspectServe();
          if (hasConflict(config, node.host))
            throw new Error(
              `Tailscale routes on HTTPS port ${port} changed during setup. Check the routes, then try again.`,
            );
        }
        if (!routesReady(config, node.host))
          throw new Error(
            "Tailscale did not confirm the Roomkit routes. Check the Tailscale connection, then try again.",
          );
        save({ enabled: true, host: node.host, logins: selected });
        options.onAccessChange();
        return await status();
      } finally {
        isChanging = false;
      }
    },
    async disable() {
      if (isChanging)
        throw new Error("Roomkit is already updating remote access.");
      isChanging = true;
      try {
        const { host, logins } = saved;
        save({ enabled: false, host, logins });
        options.onAccessChange();
        if (host) {
          const node = await inspectNode();
          if (node.kind !== "connected")
            throw new Error(prerequisiteMessages[node.kind]);
          if (node.host !== host)
            throw new Error(
              "Roomkit stopped accepting remote connections. Switch Tailscale back to the account and device name used to enable Roomkit, then remove the remaining Serve routes.",
            );
          await removeRoutes(host);
          save({ enabled: false, logins });
        }
        return await status();
      } finally {
        isChanging = false;
      }
    },
  };
}
