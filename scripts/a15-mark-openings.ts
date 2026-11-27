import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";
import { isOpeningName } from "./a15/is-opening-name.ts";

const args = process.argv.slice(2);
const folder = args.find((argument) => !argument.startsWith("--"));
if (
  !folder ||
  args.some((argument) => argument.startsWith("--") && argument !== "--apply")
)
  throw new Error(
    "Usage: node scripts/a15-mark-openings.ts <project-folder> [--apply]",
  );
const projectFolder = realpathSync(resolve(folder));
const saved = ProjectSchema.parse(
  JSON.parse(readFileSync(join(projectFolder, "project.json"), "utf8")),
);
const apply = args.includes("--apply");

function candidates(project: z.infer<typeof ProjectSchema>) {
  return project.scene.items.filter(
    (item) =>
      item.placement.kind === "wall" &&
      isOpeningName(item.name) &&
      item.cutsOpening === undefined,
  );
}

if (!apply) {
  for (const item of candidates(saved))
    process.stdout.write(`Would mark ${item.id}: ${item.name}\n`);
  process.stdout.write(
    `Dry run: ${candidates(saved).length} wall openings; use --apply to write through the daemon.\n`,
  );
} else {
  const projects =
    process.env.PLANNER_PROJECTS ??
    join(homedir(), "InteriorPlanner", "projects");
  if (realpathSync(join(projects, saved.id)) !== projectFolder)
    throw new Error(
      "Project folder does not match the daemon projects directory",
    );
  const home = process.env.PLANNER_HOME ?? join(homedir(), ".interior-planner");
  const daemon = z
    .object({ port: z.number().int().positive(), token: z.string() })
    .parse(JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")));
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
  async function command(request: { type: string; [key: string]: unknown }) {
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error(`Timed out: ${request.type}`)),
        10000,
      );
      function finish(error?: Error, result?: unknown) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        socket.off("error", finish);
        if (error) reject(error);
        else resolve(result);
      }
      function onMessage(data: { toString(): string }) {
        const frame = ServerMessageSchema.parse(JSON.parse(data.toString()));
        if (frame.type !== "command.ack" || frame.requestId !== requestId)
          return;
        finish(
          frame.ok ? undefined : new Error(frame.error),
          frame.ok ? frame.result : undefined,
        );
      }
      socket.on("message", onMessage);
      socket.on("error", finish);
      socket.send(JSON.stringify({ ...request, requestId }));
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("Daemon authentication timed out")),
        10000,
      );
      function finish(error?: Error) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        socket.off("error", finish);
        if (error) reject(error);
        else resolve();
      }
      function onMessage(data: { toString(): string }) {
        const frame = ServerMessageSchema.parse(JSON.parse(data.toString()));
        if (frame.type === "auth.ok") finish();
        if (frame.type === "auth.error")
          finish(new Error("Daemon authentication failed"));
      }
      socket.on("message", onMessage);
      socket.on("error", finish);
      socket.once("open", () =>
        socket.send(JSON.stringify({ type: "auth", token: daemon.token })),
      );
    });
    const project = ProjectSchema.parse(
      await command({ type: "project.open", projectId: saved.id }),
    );
    for (const item of candidates(project)) {
      await command({
        type: "scene.apply",
        projectId: project.id,
        command: {
          type: "item.update",
          itemId: item.id,
          patch: { cutsOpening: true },
        },
      });
      process.stdout.write(`Marked ${item.id}: ${item.name}\n`);
    }
    process.stdout.write(
      `Applied ${candidates(project).length} wall openings.\n`,
    );
  } finally {
    socket.close();
  }
}
