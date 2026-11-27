import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import WebSocket from "ws";

/** Send one command to the e2e daemon as the web app and return the ack's `result`; throw when the ack is not `ok`. */
export function sendDaemonCommand(command: {
  type: string;
  [key: string]: unknown;
}) {
  const webPort = process.env.PLANNER_WEB_PORT ?? "3210";
  const daemonPort = process.env.PLANNER_PORT ?? "4820";
  const requestId = crypto.randomUUID();
  const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`, {
    origin: `http://127.0.0.1:${webPort}`,
  });
  return new Promise<unknown>((resolve, reject) => {
    socket.on("error", reject);
    socket.on("open", () =>
      socket.send(JSON.stringify({ ...command, requestId })),
    );
    socket.on("message", (data) => {
      const ack = CommandAckSchema.safeParse(JSON.parse(data.toString()));
      if (!ack.success || ack.data.requestId !== requestId) return;
      socket.close();
      if (ack.data.ok) resolve(ack.data.result);
      else reject(new Error(ack.data.error));
    });
  });
}
