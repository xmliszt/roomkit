import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, request } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { createDaemon } from "../../packages/daemon/src/create-daemon.ts";

const root = z.string().parse(process.argv.at(2));
const host = "roomkit-host.example-tailnet.ts.net:8443";
const daemon = createDaemon({
  env: {
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
    PLANNER_PORT: "0",
    PLANNER_ALLOWED_HOSTS: host,
    PLANNER_TAILNET_LOGINS: "planner@example.com",
    PLANNER_WEB_ORIGIN: `https://${host}`,
  },
});
const address = await daemon.listen();
let login: string | undefined;
let received: IncomingHttpHeaders = {};
const proxy = createServer((incoming, outgoing) => {
  if (incoming.url === "/received") {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify(received));
    return;
  }
  if (!incoming.url?.startsWith("/daemon/")) {
    outgoing.writeHead(200, { "content-type": "text/html" });
    outgoing.end("<!doctype html><title>Tailnet access</title>");
    return;
  }
  received = incoming.headers;
  const headers: IncomingHttpHeaders = {
    ...incoming.headers,
    host,
    "x-forwarded-host": host,
  };
  delete headers["tailscale-user-login"];
  if (login !== undefined) headers["tailscale-user-login"] = login;
  const upstream = request(
    {
      hostname: address.address,
      port: address.port,
      path: incoming.url.slice("/daemon".length),
      method: incoming.method,
      headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 500, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
});
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const bound = proxy.address();
if (bound === null || typeof bound === "string")
  throw new Error("Proxy did not listen");
process.on("message", (message) => {
  login = z.object({ login: z.string().optional() }).parse(message).login;
  process.send?.({ type: "login.updated" });
});
process.on("SIGTERM", async () => {
  await new Promise<void>((resolve) => {
    proxy.close(() => resolve());
    proxy.closeAllConnections();
  });
  await daemon.close();
  process.disconnect();
});
process.send?.({ type: "ready", port: bound.port });
