import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: { [extension: string]: string } = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Serve each folder in `roots` under `/<prefix>/` on a free local port, and return the base URL and a `close`. */
export async function serveInspectPage(options: {
  roots: { [prefix: string]: string };
}) {
  const server = createServer(async (request, response) => {
    const [prefix = "", ...rest] = new URL(
      request.url ?? "/",
      "http://host",
    ).pathname
      .slice(1)
      .split("/")
      .map(decodeURIComponent);
    const root = Object.hasOwn(options.roots, prefix)
      ? options.roots[prefix]
      : undefined;
    const path = root ? normalize(join(root, ...rest)) : undefined;
    if (!root || !path || !(path === root || path.startsWith(root + sep))) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(path);
      response
        .writeHead(200, {
          "content-type":
            CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The inspection server has no port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}
