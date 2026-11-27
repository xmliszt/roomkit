import type { Server } from "node:http";
import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { AuthMessageSchema } from "@planner/shared/src/protocol/auth-message-schema.ts";
import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import type { ServerMessage } from "@planner/shared/src/protocol/server-message-schema.ts";
import { type WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Logger } from "../util/logger.ts";
import type { AuthService } from "./auth.ts";
import type { EventBus } from "./event-bus.ts";
import type { buildSnapshot } from "./snapshot.ts";

type DashboardDependencies = {
  server: Server;
  bus: EventBus;
  auth: AuthService;
  logger: Logger;
  webOrigins: string[];
  snapshot: () => ReturnType<typeof buildSnapshot>;
  onCommand: (
    command: ClientCommand,
    context: { isAgent: boolean; isLocalBrowser: boolean; connection?: object },
  ) => unknown;
  onDisconnect?: (connection: object) => void;
};

export class DashboardServer {
  private wss: WebSocketServer | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly internal = new Set<WebSocket>();
  private readonly localBrowsers = new WeakSet<WebSocket>();
  private readonly tailnetBrowsers = new WeakSet<WebSocket>();
  private readonly browsers = new Set<WebSocket>();
  private readonly deps: DashboardDependencies;

  constructor(deps: DashboardDependencies) {
    this.deps = deps;
  }

  start() {
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 34 * 1024 * 1024,
    });
    this.wss = wss;
    this.unsubscribe = this.deps.bus.subscribe((event) =>
      this.broadcast(event),
    );
    this.deps.server.on("upgrade", (request, socket, head) => {
      socket.on("error", () => undefined);
      const address = this.deps.server.address();
      if (
        !this.deps.auth.allowsHost({
          headers: request.headers,
          port: address && typeof address !== "string" ? address.port : 0,
        }) ||
        !this.deps.auth.allowsOrigin({
          headers: request.headers,
          webOrigins: this.deps.webOrigins,
        })
      ) {
        socket.end(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return;
      }
      if (request.url?.split("?").at(0) !== "/ws") {
        socket.end(
          "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        const isTailnet = this.deps.auth.allowsTailnet({
          headers: request.headers,
          webOrigins: this.deps.webOrigins,
        });
        if (isTailnet) this.tailnetBrowsers.add(client);
        if (request.headers.origin !== undefined || isTailnet)
          this.browsers.add(client);
        if (
          !isTailnet &&
          this.browsers.has(client) &&
          /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(
            request.headers.host ?? "",
          ) &&
          /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
            request.headers.origin ?? "",
          )
        )
          this.localBrowsers.add(client);
        wss.emit("connection", client);
      });
    });
    wss.on("connection", (socket: WebSocket) => {
      socket.on("error", () => undefined);
      socket.on("close", () => {
        this.deps.onDisconnect?.(socket);
        this.internal.delete(socket);
        this.browsers.delete(socket);
      });
      socket.on("message", (data) =>
        this.onMessage({ raw: data.toString(), socket }),
      );
      if (this.browsers.has(socket)) this.sendSnapshot(socket);
    });
    wss.on("error", (error) =>
      this.deps.logger.error(`ws server error: ${error.message}`),
    );
  }

  isInternal(socket: WebSocket) {
    return this.internal.has(socket);
  }

  get internalCount() {
    return this.internal.size;
  }

  private sendSnapshot(socket: WebSocket) {
    try {
      this.send({ socket, message: this.deps.snapshot() });
    } catch (error) {
      this.deps.logger.error(String(error));
      socket.close(1011, "Snapshot unavailable");
    }
  }

  private isTrusted(socket: WebSocket) {
    return this.browsers.has(socket) || this.internal.has(socket);
  }

  private isLocalBrowser(socket: WebSocket) {
    return this.localBrowsers.has(socket) && !this.internal.has(socket);
  }

  private send(options: { socket: WebSocket; message: unknown }) {
    if (options.socket.readyState === 1)
      options.socket.send(JSON.stringify(options.message));
  }

  private broadcast(event: PlannerEvent) {
    for (const socket of this.wss?.clients ?? [])
      if (this.isTrusted(socket))
        this.send({ socket, message: { type: "event", event } });
  }

  sync() {
    const message = this.deps.snapshot();
    for (const socket of this.wss?.clients ?? [])
      if (this.isTrusted(socket)) this.send({ socket, message });
    return message;
  }

  announceLanguageChange(locale: AppLocale) {
    const message = {
      type: "language.changed",
      locale,
    } satisfies ServerMessage;
    for (const socket of this.browsers)
      if (this.isLocalBrowser(socket)) this.send({ socket, message });
  }

  private handleAuth(options: { json: unknown; socket: WebSocket }) {
    const parsed = AuthMessageSchema.safeParse(options.json);
    if (
      !parsed.success ||
      !this.deps.auth.validateInternal(parsed.data.token)
    ) {
      this.internal.delete(options.socket);
      this.send({
        socket: options.socket,
        message: { type: "auth.error", message: "Invalid internal token" },
      });
      return;
    }
    const isFirst = !this.isTrusted(options.socket);
    this.internal.add(options.socket);
    this.send({ socket: options.socket, message: { type: "auth.ok" } });
    if (isFirst) this.sendSnapshot(options.socket);
  }

  private async onMessage(options: { raw: string; socket: WebSocket }) {
    let json: unknown;
    try {
      json = JSON.parse(options.raw);
    } catch {
      return;
    }
    if (
      json !== null &&
      typeof json === "object" &&
      "type" in json &&
      json.type === "auth"
    ) {
      this.handleAuth({ json, socket: options.socket });
      return;
    }
    const requestId =
      json !== null &&
      typeof json === "object" &&
      "requestId" in json &&
      typeof json.requestId === "string"
        ? json.requestId
        : undefined;
    if (!this.isTrusted(options.socket)) {
      if (requestId !== undefined)
        this.sendAck({
          socket: options.socket,
          requestId,
          ok: false,
          error: "Send the internal token before any command",
        });
      return;
    }
    const parsed = ClientCommandSchema.safeParse(json);
    if (!parsed.success) {
      if (requestId !== undefined)
        this.sendAck({
          socket: options.socket,
          requestId,
          ok: false,
          error: "Invalid command",
          issues: parsed.error.issues,
        });
      return;
    }
    try {
      const result = await this.deps.onCommand(parsed.data, {
        isAgent: this.internal.has(options.socket),
        isLocalBrowser: this.isLocalBrowser(options.socket),
        connection: options.socket,
      });
      if (requestId !== undefined)
        this.sendAck({ socket: options.socket, requestId, ok: true, result });
    } catch (error) {
      if (requestId !== undefined)
        this.sendAck({
          socket: options.socket,
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          issues: error instanceof z.ZodError ? error.issues : undefined,
        });
    }
  }

  private sendAck(options: {
    socket: WebSocket;
    requestId: string;
    ok: boolean;
    error?: string;
    issues?: z.ZodIssue[] | undefined;
    result?: unknown;
  }) {
    const { socket, ...ack } = options;
    this.send({ socket, message: { type: "command.ack", ...ack } });
  }

  disconnectTailnetBrowsers() {
    for (const socket of this.browsers)
      if (this.tailnetBrowsers.has(socket)) socket.terminate();
  }

  stop() {
    this.unsubscribe?.();
    for (const socket of this.wss?.clients ?? []) socket.terminate();
    this.wss?.close();
    this.wss = undefined;
    this.internal.clear();
    this.browsers.clear();
  }
}
