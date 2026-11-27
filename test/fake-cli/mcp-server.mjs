#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (process.env.FAKE_MCP_REQUESTS_PATH) {
    appendFileSync(
      process.env.FAKE_MCP_REQUESTS_PATH,
      `${JSON.stringify(request)}\n`,
    );
  }
  if (request.id === undefined) continue;
  const result = (() => {
    if (request.method === "initialize") {
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-planner", version: "0.0.1" },
      };
    }
    if (request.method === "tools/list") {
      return {
        tools: ["scene_get", "scene_apply", "chat_post"].map((name) => ({
          name,
          inputSchema: { type: "object" },
        })),
      };
    }
    if (request.method === "tools/call") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tool: request.params.name,
              arguments: request.params.arguments,
            }),
          },
        ],
      };
    }
    throw new Error(`Unknown MCP method: ${request.method}`);
  })();
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
  );
}
