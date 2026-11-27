import type { createOrchestratorLink } from "./create-orchestrator-link.ts";

export type ToolContext = {
  link: ReturnType<typeof createOrchestratorLink>;
  projectId: string;
  turnId: string;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: { [key: string]: unknown };
  call: (input: unknown, context: ToolContext) => Promise<unknown>;
};
