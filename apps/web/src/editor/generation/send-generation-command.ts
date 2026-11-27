import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { createPlannerSession } from "../../ws/create-planner-session.ts";

export async function sendGenerationCommand(options: {
  command: ReturnType<typeof createPlannerSession>["command"];
  request: ClientCommand;
}) {
  const ack = await options.command(options.request);
  if (!ack.ok) throw new Error(ack.error);
}
