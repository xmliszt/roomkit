import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@planner/shared/src/config/config-schema.ts";

/** Write the per-turn MCP config (mode 0600) that starts the planner server for one project and turn, and return its path. */
export function writeMcpConfig(options: {
  projectId: string;
  turnId: string;
  role: Role;
  allowedTools: string[];
  token: string;
  wsUrl: string;
  dir: string;
}) {
  const server = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./main.ts", import.meta.url))],
    env: {
      PLANNER_PROJECT_ID: options.projectId,
      PLANNER_TURN: options.turnId,
      PLANNER_ROLE: options.role,
      PLANNER_ALLOWED_TOOLS: JSON.stringify(options.allowedTools),
      PLANNER_TOKEN: options.token,
      PLANNER_WS_URL: options.wsUrl,
    },
  };
  mkdirSync(options.dir, { recursive: true });
  const path = join(resolve(options.dir), "planner-mcp.json");
  writeFileSync(
    path,
    `${JSON.stringify({ mcpServers: { planner: server } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}
