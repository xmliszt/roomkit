import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModelWeights } from "@planner/shared/src/preflight/preflight-schema.ts";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import { writeJson } from "../util/write-json.ts";
import {
  DOWNLOAD_MARKER,
  readModelDownloadBytes,
} from "./read-model-download-bytes.ts";
import type { RegistryModel } from "./read-model-registry.ts";

export const COMPLETE_MARKER = ".complete.json";

function folderSizeBytes(path: string): number {
  try {
    return readdirSync(path, { withFileTypes: true }).reduce(
      (sum, entry) =>
        sum +
        (entry.name === COMPLETE_MARKER || entry.name === DOWNLOAD_MARKER
          ? 0
          : entry.isDirectory()
            ? folderSizeBytes(join(path, entry.name))
            : entry.isFile()
              ? statSync(join(path, entry.name)).size
              : 0),
      0,
    );
  } catch (error) {
    if (isMissingPathError(error)) return 0;
    throw error;
  }
}

function readMarkerRevision(path: string) {
  try {
    const marker: unknown = JSON.parse(
      readFileSync(join(path, COMPLETE_MARKER), "utf8"),
    );
    return typeof marker === "object" &&
      marker !== null &&
      "revision" in marker &&
      typeof marker.revision === "string"
      ? marker.revision
      : undefined;
  } catch {
    return undefined;
  }
}

export function readModelWeights(options: {
  model: RegistryModel;
  weightsRoot: string;
}): ModelWeights {
  const path = join(options.weightsRoot, options.model.folder);
  const sizeBytes = folderSizeBytes(path);
  const complete = options.model.files.every((file) => {
    try {
      const entry = lstatSync(join(path, file.path));
      return entry.isFile() && entry.size === file.sizeBytes;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  });
  if (complete && readMarkerRevision(path) !== options.model.revision)
    writeJson({
      path: join(path, COMPLETE_MARKER),
      value: { revision: options.model.revision },
    });
  return {
    id: options.model.id,
    name: options.model.name,
    path,
    sizeBytes,
    remainingDownloadBytes: complete
      ? 0
      : readModelDownloadBytes({ model: options.model, folder: path }),
    expectedSizeBytes: options.model.files.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    ),
    state: complete ? "present" : sizeBytes > 0 ? "partial" : "missing",
  };
}
