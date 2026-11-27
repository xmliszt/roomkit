import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { ToolContext } from "../tool-context.ts";

export async function requestOrThrow(options: {
  context: ToolContext;
  command: ClientCommand;
}) {
  const response = await options.context.link.request(options.command);
  if (!response.ok) throw new Error(response.error ?? "The daemon refused");
  return response.result;
}
