import { statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMissingPathError } from "../util/is-missing-path-error.ts";

export function readFreeStorage(path: string): number | undefined {
  const resolved = resolve(path);
  try {
    const disk = statfsSync(resolved);
    return disk.bavail * disk.bsize;
  } catch (error) {
    const parent = dirname(resolved);
    if (parent !== resolved && isMissingPathError(error))
      return readFreeStorage(parent);
    return undefined;
  }
}
