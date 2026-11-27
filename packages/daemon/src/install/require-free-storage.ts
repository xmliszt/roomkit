import { STORAGE_HEADROOM_BYTES } from "@planner/shared/src/preflight/setup-storage.ts";
import { readFreeStorage } from "../preflight/read-free-storage.ts";

export function requireFreeStorage(options: {
  folder: string;
  additionalBytes: number;
}) {
  const freeBytes = readFreeStorage(options.folder);
  const requiredBytes = options.additionalBytes + STORAGE_HEADROOM_BYTES;
  if (freeBytes !== undefined && freeBytes < requiredBytes)
    throw new Error(
      `Free at least ${((requiredBytes - freeBytes) / 1e9).toFixed(2)} GB on the disk for ${options.folder}, then retry.`,
    );
}
