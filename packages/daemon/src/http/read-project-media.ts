import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { HttpError } from "./http-error.ts";

const linkTypes: { [extension: string]: string } = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

export async function readProjectMedia(options: {
  folder: string;
  kind: "photos" | "links";
  id: string;
  thumbnail: boolean;
  response: ServerResponse;
}) {
  function notFound(): never {
    throw new HttpError({ status: 404, message: "Not found" });
  }
  const media = (() => {
    if (options.kind === "photos") {
      if (!IdSchema.safeParse(options.id).success) return notFound();
      const photo = readPhotos(options.folder).find(
        (photo) => photo.photoId === options.id,
      );
      if (photo?.kind !== "accepted") return notFound();
      return {
        path: join(
          options.folder,
          "photos",
          options.thumbnail ? "thumb" : "vision",
          `${photo.photoId}.jpg`,
        ),
        contentType: "image/jpeg",
      };
    }
    const match = /^([a-f0-9]{32})\.(jpg|png|gif|webp|avif)$/.exec(options.id);
    const extension = match?.at(2);
    if (!extension) return notFound();
    return {
      path: join(options.folder, ".planner", "links", options.id),
      contentType: linkTypes[extension] ?? "application/octet-stream",
    };
  })();
  if (!existsSync(media.path)) return notFound();
  const path = realpathSync(media.path);
  const inside = relative(realpathSync(options.folder), path);
  if (inside.startsWith("..") || isAbsolute(inside) || !statSync(path).isFile())
    return notFound();
  options.response.writeHead(200, {
    "content-type": media.contentType,
    "content-length": statSync(path).size,
    "x-content-type-options": "nosniff",
  });
  await pipeline(createReadStream(path), options.response);
}
