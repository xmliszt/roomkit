import { randomUUID } from "node:crypto";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import type { Page, WebSocketRoute } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";

export async function cameraFramingFixture(options: { page: Page }) {
  const project = await createProject({
    name: "Camera framing",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  project.scene.camera = {
    positionM: { x: 2.5, y: 1.3, z: 2.5 },
    targetM: { x: 1.8, y: 1, z: 1.8 },
  };
  const sockets: WebSocketRoute[] = [];
  const commands: Command[] = [];
  function emit(event: PlannerEvent) {
    for (const socket of sockets)
      socket.send(JSON.stringify({ type: "event", event }));
  }
  function apply(input: { command: Command; requestId?: string | undefined }) {
    const result = applyCommand({
      scene: project.scene,
      command: input.command,
    });
    if (result.kind === "rejected") throw new Error(result.reason);
    project.scene = result.scene;
    project.revision++;
    emit({
      kind: "scene.changed",
      projectId: project.id,
      command: input.command,
      revision: project.revision,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  }
  await options.page.routeWebSocket(
    `ws://127.0.0.1:${process.env.PLANNER_PORT}/**`,
    (socket) => {
      sockets.push(socket);
      socket.onClose(() => {
        const index = sockets.indexOf(socket);
        if (index >= 0) sockets.splice(index, 1);
      });
      const server = socket.connectToServer();
      server.onMessage((raw) => socket.send(raw));
      socket.onMessage((raw) => {
        const command = ClientCommandSchema.parse(JSON.parse(String(raw)));
        if (command.type !== "project.open" && command.type !== "scene.apply") {
          server.send(raw);
          return;
        }
        if (command.type === "scene.apply") {
          commands.push(command.command);
          apply({ command: command.command, requestId: command.requestId });
        }
        socket.send(
          JSON.stringify({
            type: "command.ack",
            ok: true,
            requestId: command.requestId,
            result:
              command.type === "project.open"
                ? project
                : { revision: project.revision },
          }),
        );
      });
    },
  );
  function reconstruct(input: { stage: "done" | "failed" }) {
    const jobId = randomUUID();
    project.reconstruction = { jobId, weakScale: false };
    apply({
      command: {
        type: "room.update",
        ceilingHeightM: project.scene.room.ceilingHeightM + 0.01,
      },
    });
    emit({
      kind: "job.updated",
      job: {
        id: jobId,
        kind: "reconstruction",
        projectId: project.id,
        stage: input.stage,
        progress: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return { project, commands, apply, reconstruct };
}
