import { readFileSync } from "node:fs";
import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import {
  type ClientCommand,
  ClientCommandSchema,
} from "@planner/shared/src/protocol/client-command-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import type { Page, WebSocketRoute } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { generationFixture } from "./generation-fixture.ts";

export async function mockGeneration(options: {
  page: Page;
  count: number;
  name?: string;
  sidecars?: "missing";
  messages?: ChatMessage[];
  textured?: boolean;
  regenerationStage?: "queued" | "generating";
  generationAck?: Promise<void>;
  sizeM?: Size;
  handleCommand?: (
    command: ClientCommand,
  ) => { ok: true; result: unknown } | { ok: false; error: string } | undefined;
}) {
  const project = await createProject({
    name: options.name ?? "Generation preview",
    widthM: 6,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  project.scene.camera = {
    positionM: { x: 0, y: 6, z: 6 },
    targetM: { x: 0, y: 0, z: 0 },
  };
  project.scene.items = Array.from(
    { length: options.count },
    (_, index): Item => ({
      id: `item-${index}`,
      name: `Chair ${index + 1}`,
      model: { kind: "pending", jobId: `job-${index}` },
      sizeM: options.sizeM ?? { width: 1.2, height: 1.2, depth: 1.2 },
      placement: {
        kind: "floor",
        xM: options.count === 1 ? 0 : (index % 2) * 2 - 1,
        zM: Math.floor(index / 2) * 2 - 1,
        elevationM: 0,
        rotationRad: 0,
      },
      locked: false,
    }),
  );
  const jobs: Job[] = project.scene.items.map((item, index) => ({
    id: `job-${index}`,
    kind: "generation",
    projectId: project.id,
    itemId: item.id,
    stage: "queued",
    progress: 0,
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:00:00Z",
  }));
  const messages: ChatMessage[] = options.messages ?? [
    {
      id: "generation-chat",
      author: { kind: "agent", role: "modeler" },
      status: "done",
      createdAt: "2026-11-23T00:00:00Z",
      blocks: [
        { kind: "job", jobId: "job-0" },
        {
          kind: "asset",
          assetId: "fixture-model",
          name: "Orange chair",
          sizeM: options.sizeM ?? { width: 1, height: 1, depth: 1 },
        },
      ],
    },
  ];
  const sockets: WebSocketRoute[] = [];
  const sentCommands: unknown[] = [];
  const generationAcknowledged = Promise.withResolvers<void>();
  function emit(event: PlannerEvent) {
    for (const socket of sockets)
      socket.send(JSON.stringify({ type: "event", event }));
  }
  function apply(input: { command: Command; requestId?: string | undefined }) {
    const { command, requestId } = input;
    const result = applyCommand({ scene: project.scene, command });
    if (result.kind === "rejected") throw new Error(result.reason);
    project.scene = result.scene;
    project.revision++;
    emit({
      kind: "scene.changed",
      projectId: project.id,
      command,
      revision: project.revision,
      ...(requestId ? { requestId } : {}),
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
      server.onMessage((raw) => {
        const message = ServerMessageSchema.parse(JSON.parse(String(raw)));
        socket.send(
          message.type === "snapshot"
            ? JSON.stringify({ ...message, jobs })
            : raw,
        );
      });
      socket.onMessage(async (raw) => {
        const command = ClientCommandSchema.parse(JSON.parse(String(raw)));
        sentCommands.push(command);
        const handled = options.handleCommand?.(command);
        if (handled) {
          socket.send(
            JSON.stringify({
              type: "command.ack",
              requestId: command.requestId,
              ...handled,
            }),
          );
          return;
        }
        if (command.type === "project.open")
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: project,
            }),
          );
        else if (command.type === "surface.assets")
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: { assets: [] },
            }),
          );
        else if (command.type === "job.log")
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: {
                firstLineIndex: 0,
                lines: ["RESULT fixture worker log"],
              },
            }),
          );
        else if (command.type === "chat.history")
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: {
                messages,
              },
            }),
          );
        else if (command.type === "scene.apply") {
          apply({ command: command.command, requestId: command.requestId });
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
            }),
          );
        } else if (command.type === "job.cancel") {
          stage({
            index: jobs.findIndex((job) => job.id === command.jobId),
            stage: "held",
            progress: 0,
          });
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: { jobId: command.jobId, stage: "held" },
            }),
          );
        } else if (command.type === "generation.start") {
          stage({
            index: Number(command.itemId.slice(5)),
            stage: "generating",
          });
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: { jobId: `job-${command.itemId.slice(5)}` },
            }),
          );
        } else if (command.type === "generation.regenerate") {
          const now = new Date().toISOString();
          const job: Job = {
            id: `regeneration-${jobs.length}`,
            kind: "generation",
            projectId: project.id,
            itemId: command.itemId,
            stage: options.regenerationStage ?? "generating",
            progress: 0,
            createdAt: now,
            updatedAt: now,
          };
          jobs.push(job);
          emit({ kind: "job.updated", job });
          await options.generationAck;
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: { jobId: job.id },
            }),
          );
          generationAcknowledged.resolve();
        } else if (command.type === "generation.alternatives") {
          const alternatives = startAlternatives({
            itemId: command.itemId,
            method: command.method,
          });
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
              result: { jobIds: alternatives.map((job) => job.id) },
            }),
          );
        } else if (command.type === "chat.send") {
          const message: ChatMessage = {
            id: `designer-reply-${messages.length}`,
            author: { kind: "agent", role: "designer" },
            status: "done",
            createdAt: "2026-11-23T02:00:00Z",
            blocks: [
              {
                kind: "text",
                markdown: `I received your request: ${command.text}`,
              },
            ],
          };
          messages.push(message);
          emit({ kind: "chat.message.added", projectId: project.id, message });
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: true,
              requestId: command.requestId,
            }),
          );
        } else server.send(raw);
      });
    },
  );
  const thumbnail = readFileSync(
    new URL(
      "../../../packages/daemon/catalog/charging-port/thumb.png",
      import.meta.url,
    ),
  );
  const fixture = generationFixture({
    ...(options.textured
      ? {
          textureDataUrl: `data:image/png;base64,${thumbnail.toString("base64")}`,
        }
      : {}),
  });
  await options.page.route(
    `**/projects/${project.id}/assets/*/*`,
    async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").at(-1);
      const body =
        file === "thumb.png"
          ? thumbnail
          : file === "model.glb"
            ? fixture.glb
            : file === "points.bin"
              ? fixture.points
              : file === "lines.bin"
                ? fixture.lines
                : JSON.stringify({
                    id: "fixture-model",
                    kind: "generated",
                    mount: "floor",
                    nativeSizeM: { width: 1, height: 1, depth: 1 },
                    triangleCount: 12,
                    hasColorMask: false,
                    provenance: { method: "fixture", sourcePhotoIds: [] },
                  });
      await route.fulfill({
        status:
          options.sidecars === "missing" && file?.endsWith(".bin") ? 404 : 200,
        contentType:
          file === "thumb.png"
            ? "image/png"
            : file === "meta.json"
              ? "application/json"
              : "application/octet-stream",
        body,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await options.page.route(
    `**/projects/${project.id}/rejected/*/thumb.png`,
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: thumbnail,
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  function stage(input: {
    index: number;
    stage: "held" | "queued" | "generating" | "ready" | "failed";
    progress?: number;
  }) {
    const job = jobs.at(input.index);
    if (job?.kind !== "generation") throw new Error("Missing fixture job");
    const next: Job = {
      ...job,
      stage: input.stage,
      progress: input.progress ?? (input.stage === "ready" ? 1 : 0.7),
      lastLogLine:
        input.stage === "failed" ? "Generation failed" : "Preparing mesh",
    };
    jobs[input.index] = next;
    emit({ kind: "job.updated", job: next });
  }
  function ready(index: number) {
    apply({
      command: {
        type: "item.update",
        itemId: `item-${index}`,
        patch: {
          model: { kind: "asset", assetId: "fixture-model" },
          sizeM: options.sizeM ?? { width: 1, height: 1, depth: 1 },
        },
      },
    });
    stage({ index, stage: "ready" });
  }
  function startAlternatives(input: {
    itemId: string;
    method?: "trellis2" | "sam3d" | undefined;
  }) {
    const firstIndex = jobs.filter(
      (job) => job.kind === "generation-alternative",
    ).length;
    const alternatives = (
      input.method ? [input.method] : ["trellis2", "sam3d"]
    ).map(
      (method, index): Job => ({
        id: `alternative-${firstIndex + index}`,
        kind: "generation-alternative",
        method: method === "trellis2" ? "trellis2" : "sam3d",
        projectId: project.id,
        itemId: input.itemId,
        stage: "generating",
        progress: 0.2,
        createdAt: "2026-11-23T01:00:00Z",
        updatedAt: "2026-11-23T01:00:00Z",
      }),
    );
    jobs.push(...alternatives);
    for (const job of alternatives) emit({ kind: "job.updated", job });
    return alternatives;
  }
  function updateAlternative(input: {
    method: "trellis2" | "sam3d";
    stage: "generating" | "failed";
    lastLogLine: string;
    progress: number;
    error?: string;
    waitingFor?: "machine";
    hasRejectedModel?: boolean;
  }) {
    const index = jobs.findIndex(
      (job) =>
        job.kind === "generation-alternative" && job.method === input.method,
    );
    const job = jobs.at(index);
    if (job?.kind !== "generation-alternative")
      throw new Error("Missing fixture alternative");
    const next = { ...job, ...input, waitingFor: input.waitingFor };
    jobs[index] = next;
    emit({ kind: "job.updated", job: next });
  }
  function finishAlternatives() {
    for (const [index, job] of jobs.entries()) {
      if (job.kind !== "generation-alternative") continue;
      jobs[index] = { ...job, stage: "ready", progress: 1 };
      emit({ kind: "job.updated", job: jobs[index] });
      const message: ChatMessage = {
        id: job.id,
        author: { kind: "agent", role: "modeler" },
        status: "done",
        createdAt: job.createdAt,
        blocks: [
          { kind: "job", jobId: job.id },
          {
            kind: "asset",
            assetId: `fixture-${job.method}`,
            name: `${job.method} chair`,
            sizeM: options.sizeM ?? { width: 1.4, height: 1.1, depth: 0.8 },
            sizeMismatches: [
              { axis: "height", actualM: 0.49, expectedM: 0.67 },
            ],
          },
        ],
      };
      messages.push(message);
      emit({ kind: "chat.message.added", projectId: project.id, message });
    }
  }
  function updateJob(job: Job) {
    const index = jobs.findIndex((entry) => entry.id === job.id);
    if (index < 0) jobs.push(job);
    else jobs[index] = job;
    emit({ kind: "job.updated", job });
  }
  return {
    updateJob,
    apply,
    camera: project.scene.camera,
    projectId: project.id,
    stage,
    ready,
    sentCommands,
    generationAcknowledged: generationAcknowledged.promise,
    finishAlternatives,
    startAlternatives,
    updateAlternative,
  };
}
