import { randomUUID } from "node:crypto";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import { PlannerEventSchema } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { SnapshotMessageSchema } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import { WebSocket } from "ws";
import { z } from "zod";

const ackSchema = z.object({
  type: z.literal("command.ack"),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  result: z.unknown().optional(),
});
type CommandResult = { ok: boolean; error?: string; result?: unknown };

export function createOrchestratorLink(options: {
  url: string;
  token: string;
  timeoutMs?: number;
}) {
  const socket = new WebSocket(options.url);
  const pending: { [id: string]: (result: CommandResult) => void } = {};
  let authenticated = false;
  let closed = false;
  const queued: { [id: string]: string } = {};
  const jobs: { [jobId: string]: Job } = Object.create(null);
  function fail(error: string) {
    closed = true;
    for (const settle of Object.values(pending)) settle({ ok: false, error });
  }
  socket.on("open", () =>
    socket.send(JSON.stringify({ type: "auth", token: options.token })),
  );
  socket.on("message", (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (z.object({ type: z.literal("auth.ok") }).safeParse(message).success) {
      authenticated = true;
      for (const frame of Object.values(queued)) socket.send(frame);
      for (const id of Object.keys(queued)) delete queued[id];
      return;
    }
    if (
      z.object({ type: z.literal("auth.error") }).safeParse(message).success
    ) {
      fail("Internal authentication failed");
      socket.close();
      return;
    }
    const snapshot = SnapshotMessageSchema.safeParse(message);
    if (snapshot.success) {
      for (const id of Object.keys(jobs)) delete jobs[id];
      for (const job of snapshot.data.jobs) jobs[job.id] = job;
      return;
    }
    const event = z
      .object({ type: z.literal("event"), event: PlannerEventSchema })
      .safeParse(message);
    if (event.success) {
      if (event.data.event.kind === "job.updated")
        jobs[event.data.event.job.id] = event.data.event.job;
      return;
    }
    const ack = ackSchema.safeParse(message);
    if (ack.success)
      pending[ack.data.requestId]?.({
        ok: ack.data.ok,
        result: ack.data.result,
        ...(ack.data.error ? { error: ack.data.error } : {}),
      });
  });
  socket.on("error", () => fail("Daemon connection failed"));
  socket.on("close", () => fail("Daemon connection closed"));
  function request(command: ClientCommand) {
    if (closed)
      return Promise.resolve<CommandResult>({
        ok: false,
        error: "Daemon connection closed",
      });
    const requestId = randomUUID();
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(
        () => settle({ ok: false, error: "Daemon acknowledgement timed out" }),
        options.timeoutMs ?? 5000,
      );
      function settle(result: CommandResult) {
        clearTimeout(timer);
        delete pending[requestId];
        delete queued[requestId];
        resolve(result);
      }
      pending[requestId] = settle;
      const frame = JSON.stringify({ ...command, requestId });
      if (authenticated && socket.readyState === WebSocket.OPEN)
        socket.send(frame);
      else queued[requestId] = frame;
    });
  }
  return {
    request,
    readJob: (jobId: string) =>
      Object.hasOwn(jobs, jobId) ? jobs[jobId] : undefined,
    close() {
      fail("Daemon link closed");
      socket.terminate();
    },
  };
}
