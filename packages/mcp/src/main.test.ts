import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

async function startServer(options: { role: string; allowedTools: string[] }) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./main.ts", import.meta.url))],
    {
      env: {
        PATH: process.env.PATH,
        PLANNER_PROJECT_ID: "6fd0b15a-b3a8-4ed7-856c-dba67a740c10",
        PLANNER_TURN: crypto.randomUUID(),
        PLANNER_ROLE: options.role,
        PLANNER_ALLOWED_TOOLS: JSON.stringify(options.allowedTools),
        PLANNER_TOKEN: "fake-token",
        PLANNER_WS_URL: "ws://127.0.0.1:9/ws",
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  const pending: { [id: number]: (value: unknown) => void } = {};
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending[response.id]?.(response);
  });
  let nextId = 0;
  function request(method: string, params: unknown = {}) {
    const id = ++nextId;
    return new Promise<unknown>((resolve) => {
      pending[id] = resolve;
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
  return {
    request,
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

const designerTools = [
  "scene_get",
  "scene_apply",
  "asset_generate",
  "asset_variant",
  "asset_regenerate",
  "job_status",
  "chat_post",
].map((name) => `mcp__planner__${name}`);

test.each([
  {
    role: "designer",
    allowedTools: designerTools,
    expected: [
      "scene_get",
      "scene_apply",
      "asset_generate",
      "asset_variant",
      "asset_regenerate",
      "job_status",
      "chat_post",
    ],
  },
  {
    role: "designer",
    allowedTools: ["mcp__planner__scene_get"],
    expected: ["scene_get"],
  },
  { role: "modeler", allowedTools: designerTools, expected: ["job_status"] },
  {
    role: "surveyor",
    allowedTools: [...designerTools, "mcp__planner__inventory_submit"],
    expected: ["scene_get", "job_status", "chat_post", "inventory_submit"],
  },
  {
    role: "designer",
    allowedTools: ["mcp__planner__inventory_submit"],
    expected: [],
  },
  {
    role: "surveyor",
    allowedTools: ["mcp__planner__scene_get"],
    expected: ["scene_get"],
  },
])(
  "lists only tools both the $role role and --allowedTools permit",
  async (input) => {
    const server = await startServer(input);
    try {
      expect(await server.request("tools/list")).toMatchObject({
        result: { tools: input.expected.map((name) => ({ name })) },
      });
      if (!input.expected.includes("scene_apply"))
        expect(
          await server.request("tools/call", {
            name: "scene_apply",
            arguments: {},
          }),
        ).toMatchObject({
          result: {
            isError: true,
            content: [{ text: "Unknown tool: scene_apply" }],
          },
        });
      if (!input.expected.includes("inventory_submit"))
        expect(
          await server.request("tools/call", {
            name: "inventory_submit",
            arguments: { objects: [] },
          }),
        ).toMatchObject({
          result: {
            isError: true,
            content: [{ text: "Unknown tool: inventory_submit" }],
          },
        });
    } finally {
      server.close();
    }
  },
);

test("asset_generate rejects an incomplete job specification", async () => {
  const server = await startServer({
    role: "designer",
    allowedTools: designerTools,
  });
  try {
    expect(
      await server.request("tools/call", {
        name: "asset_generate",
        arguments: {},
      }),
    ).toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining("Invalid arguments") }],
      },
    });
  } finally {
    server.close();
  }
});
