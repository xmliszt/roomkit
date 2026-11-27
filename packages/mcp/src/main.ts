import { createInterface } from "node:readline";
import { RoleSchema } from "@planner/shared/src/config/config-schema.ts";
import { ProjectIdSchema } from "@planner/shared/src/project/project-id-schema.ts";
import { z } from "zod";
import { createOrchestratorLink } from "./create-orchestrator-link.ts";
import { PLANNER_TOOL_PREFIX } from "./planner-tool-prefix.ts";
import { ROLE_TOOLS } from "./role-tools.ts";
import { tools } from "./tools.ts";

const scope = z
  .object({
    PLANNER_PROJECT_ID: ProjectIdSchema,
    PLANNER_TURN: z.guid(),
    PLANNER_ROLE: RoleSchema,
    PLANNER_TOKEN: z.string().min(1),
    PLANNER_WS_URL: z.string().url(),
    PLANNER_ALLOWED_TOOLS: z.string().min(1),
  })
  .parse(process.env);
const allowedTools = z
  .array(z.string())
  .parse(JSON.parse(scope.PLANNER_ALLOWED_TOOLS));
const roleTools: readonly string[] = ROLE_TOOLS[scope.PLANNER_ROLE];
const permittedTools = tools.filter(
  (tool) =>
    roleTools.includes(tool.name) &&
    allowedTools.includes(`${PLANNER_TOOL_PREFIX}${tool.name}`),
);
const link = createOrchestratorLink({
  url: scope.PLANNER_WS_URL,
  token: scope.PLANNER_TOKEN,
  timeoutMs: scope.PLANNER_ROLE === "modeler" ? 1_800_000 : 60000,
});
const context = {
  link,
  projectId: scope.PLANNER_PROJECT_ID,
  turnId: scope.PLANNER_TURN,
};
const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
async function handle(line: string) {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    return;
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });
    return;
  }
  const request = parsed.data;
  if (request.id === undefined) return;
  const ok = (result: unknown) =>
    send({ jsonrpc: "2.0", id: request.id, result });
  switch (request.method) {
    case "initialize":
      ok({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "planner", version: "0.1.0" },
      });
      return;
    case "ping":
      ok({});
      return;
    case "tools/list":
      ok({
        tools: permittedTools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
      return;
    case "tools/call": {
      try {
        const args = z
          .object({ name: z.string(), arguments: z.unknown().optional() })
          .parse(request.params);
        const tool = permittedTools.find(
          (candidate) => candidate.name === args.name,
        );
        if (!tool) throw new Error(`Unknown tool: ${args.name}`);
        const value = await tool.call(args.arguments ?? {}, context);
        const image = z
          .object({
            kind: z.literal("image"),
            data: z.string(),
            mimeType: z.enum(["image/jpeg", "image/png"]),
          })
          .safeParse(value);
        ok({
          content: image.success
            ? [
                {
                  type: "image",
                  data: image.data.data,
                  mimeType: image.data.mimeType,
                },
              ]
            : [{ type: "text", text: JSON.stringify(value) }],
        });
      } catch (error) {
        ok({
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof z.ZodError
                  ? `Invalid arguments: ${JSON.stringify(error.issues)}`
                  : error instanceof Error
                    ? error.message
                    : String(error),
            },
          ],
        });
      }
      return;
    }
    default:
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
}
const lines = createInterface({ input: process.stdin });
try {
  for await (const line of lines) if (line.trim()) await handle(line);
} finally {
  link.close();
}
