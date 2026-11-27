import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { CommandAck } from "@planner/shared/src/protocol/command-ack-schema.ts";
import type { ServerMessage } from "@planner/shared/src/protocol/server-message-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { reconnectDelay } from "./reconnect-delay.ts";

type Pending = {
  resolve: (ack: CommandAck) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
};

export function createWsClient(options: {
  url: string;
  createSocket: (url: string) => WebSocket;
  onMessage: (message: ServerMessage) => void;
  onConnection: (state: "connecting" | "open" | "closed") => void;
}) {
  const pending: { [requestId: string]: Pending } = {};
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let attempt = 0;

  function rejectPending() {
    for (const [id, request] of Object.entries(pending)) {
      clearTimeout(request.timeout);
      request.reject(new Error("WebSocket disconnected"));
      delete pending[id];
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
  }

  function connect() {
    if (stopped) return;
    options.onConnection("connecting");
    try {
      const current = options.createSocket(options.url);
      socket = current;
      current.addEventListener("open", () => {
        if (current !== socket || stopped) return;
        options.onConnection("open");
      });
      current.addEventListener("message", (event) => {
        if (current !== socket || stopped || typeof event.data !== "string")
          return;
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        const result = ServerMessageSchema.safeParse(json);
        if (!result.success) return;
        const message = result.data;
        if (message.type === "snapshot") attempt = 0;
        if (message.type === "command.ack") {
          const request = pending[message.requestId];
          if (request) {
            clearTimeout(request.timeout);
            delete pending[message.requestId];
            request.resolve(message);
          }
          return;
        }
        options.onMessage(message);
      });
      current.addEventListener("error", () => current.close());
      current.addEventListener("close", () => {
        if (current !== socket) return;
        socket = undefined;
        options.onConnection("closed");
        rejectPending();
        scheduleReconnect();
      });
    } catch {
      options.onConnection("closed");
      scheduleReconnect();
    }
  }

  function sendCommand(request: ClientCommand) {
    if (socket?.readyState !== 1) throw new Error("WebSocket disconnected");
    socket.send(JSON.stringify(ClientCommandSchema.parse(request)));
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      const current = socket;
      socket = undefined;
      current?.close();
      rejectPending();
      options.onConnection("closed");
    },
    sendCommand,
    command(request: ClientCommand, options?: { timeoutMs?: number | null }) {
      const requestId = request.requestId ?? crypto.randomUUID();
      return new Promise<CommandAck>((resolve, reject) => {
        if (pending[requestId]) {
          reject(new Error("Duplicate requestId"));
          return;
        }
        const timeout =
          options?.timeoutMs === null
            ? undefined
            : setTimeout(() => {
                delete pending[requestId];
                reject(new Error("Command timed out"));
              }, options?.timeoutMs ?? 15_000);
        pending[requestId] = { resolve, reject, timeout };
        try {
          sendCommand({ ...request, requestId });
        } catch (error) {
          clearTimeout(timeout);
          delete pending[requestId];
          reject(error);
        }
      });
    },
  };
}
