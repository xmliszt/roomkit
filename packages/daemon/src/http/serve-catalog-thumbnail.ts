import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";

export async function serveCatalogThumbnail(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}) {
  if (options.request.method !== "GET") return false;
  const entry = CHARGING_PORT_TYPES.find(
    (type) => options.url.pathname === `/catalog/${type.assetId}/thumb.png`,
  );
  if (entry === undefined) return false;
  const path = new URL(
    `../../catalog/${entry.assetId}/thumb.png`,
    import.meta.url,
  );
  options.response.writeHead(200, {
    "content-type": "image/png",
    "content-length": statSync(path).size,
  });
  await pipeline(createReadStream(path), options.response);
  return true;
}
