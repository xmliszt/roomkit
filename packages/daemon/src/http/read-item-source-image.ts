import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { z } from "zod";
import { jobFilePath } from "../generation/job-file-path.ts";
import { readGenerationRecords } from "../objects/read-generation-records.ts";
import { readItemSource } from "../objects/read-item-source.ts";
import { readObjectJson } from "../objects/read-object-json.ts";
import { HttpError } from "./http-error.ts";

export async function readItemSourceImage(options: {
  folder: string;
  project: Project;
  itemId: string;
  index: string;
  response: ServerResponse;
}) {
  function notFound(): never {
    throw new HttpError({ status: 404, message: "Not found" });
  }
  if (
    !IdSchema.safeParse(options.itemId).success ||
    !/^(0|[1-9]\d*)$/.test(options.index)
  )
    return notFound();
  const index = Number(options.index);
  if (!Number.isSafeInteger(index)) return notFound();
  const item = options.project.scene.items.find(
    (item) => item.id === options.itemId,
  );
  if (!item) return notFound();
  const records = readGenerationRecords({
    folder: options.folder,
    projectId: options.project.id,
  });
  const source = readItemSource({ folder: options.folder, item, records });
  if (source?.source.kind !== "web") return notFound();
  const folder = source.folder;
  if (!folder) return notFound();
  const saved = z
    .object({
      photos: z.array(z.string().regex(/^photos\/[A-Za-z0-9_-]+\.(jpg|png)$/)),
    })
    .safeParse(readObjectJson({ folder, path: "job.json" }));
  if (!saved.success) return notFound();
  const fileName = saved.data.photos.at(index);
  if (!fileName || !existsSync(join(folder, fileName))) return notFound();
  const path = (() => {
    try {
      return jobFilePath({ folder, path: fileName });
    } catch {
      return notFound();
    }
  })();
  options.response.writeHead(200, {
    "content-type": fileName.endsWith(".png") ? "image/png" : "image/jpeg",
    "content-length": statSync(path).size,
    "x-content-type-options": "nosniff",
  });
  await pipeline(createReadStream(path), options.response);
}
