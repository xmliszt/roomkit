import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RegistryModel } from "./read-model-registry.ts";

export const DOWNLOAD_MARKER = ".download.json";

export function readModelDownloadBytes(options: {
  model: RegistryModel;
  folder: string;
}) {
  const { model, folder } = options;
  const canResume = (() => {
    try {
      const marker = z
        .object({ revision: z.string() })
        .parse(JSON.parse(readFileSync(join(folder, DOWNLOAD_MARKER), "utf8")));
      return marker.revision === model.revision;
    } catch {
      return false;
    }
  })();

  function fileSize(path: string) {
    try {
      const info = lstatSync(path);
      return info.isFile() ? info.size : 0;
    } catch {
      return 0;
    }
  }

  return model.files.reduce((bytes, file) => {
    if (!canResume) return bytes + file.sizeBytes;
    const path = join(folder, file.path);
    if (fileSize(path) === file.sizeBytes) return bytes;
    const partial = fileSize(`${path}.part`);
    return bytes + file.sizeBytes - (partial <= file.sizeBytes ? partial : 0);
  }, 0);
}
