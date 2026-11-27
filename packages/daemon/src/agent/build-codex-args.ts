import { readFileSync } from "node:fs";
import { z } from "zod";
import { HOOK_SCRIPT_PATH } from "./hooks.ts";
import type { TaskRunOptions } from "./run-options.ts";

const mcpSchema = z.object({
  mcpServers: z.object({
    planner: z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
  }),
});

function toml(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(", ")}]`;
  if (value && typeof value === "object")
    return `{ ${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)} = ${toml(item)}`)
      .join(", ")} }`;
  throw new Error("Unsupported Codex configuration value");
}

export function buildCodexArgs(options: TaskRunOptions) {
  const server = options.mcpConfigPath
    ? mcpSchema.parse(JSON.parse(readFileSync(options.mcpConfigPath, "utf8")))
        .mcpServers.planner
    : undefined;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const hooks = {
    PreToolUse: [
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: `${quote(process.execPath)} ${quote(HOOK_SCRIPT_PATH)}`,
          },
        ],
      },
    ],
  };
  const config = {
    approval_policy: "never",
    sandbox_mode:
      options.env?.PLANNER_READ_ONLY === "1"
        ? "read-only"
        : "danger-full-access",
    developer_instructions: options.appendSystemPrompt,
    ...(server
      ? {
          "mcp_servers.planner": {
            ...server,
            required: true,
            default_tools_approval_mode: "approve",
            tool_timeout_sec: 900,
          },
        }
      : {}),
    hooks,
    "features.hooks": true,
    "features.multi_agent": false,
    "features.apps": false,
    web_search:
      options.allowedTools === undefined ||
      options.allowedTools.includes("WebSearch")
        ? "live"
        : "disabled",
    ...(options.effort
      ? {
          model_reasoning_effort:
            options.effort === "max" ? "xhigh" : options.effort,
        }
      : {}),
  };
  return [
    "exec",
    ...(options.resume ? ["resume", options.sessionId] : []),
    "--json",
    "--ignore-user-config",
    "--dangerously-bypass-hook-trust",
    "--skip-git-repo-check",
    ...Object.entries(config).flatMap(([key, value]) => [
      "-c",
      `${key}=${toml(value)}`,
    ]),
    ...(options.model ? ["--model", options.model] : []),
    ...(options.imagePaths ?? []).flatMap((path) => ["--image", path]),
    "-",
  ];
}
