import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMissingPathError } from "../util/is-missing-path-error.ts";

export function readStorageVolume(path: string): number | undefined {
  const resolved = resolve(path);
  try {
    return statSync(resolved).dev;
  } catch (error) {
    const parent = dirname(resolved);
    if (parent !== resolved && isMissingPathError(error))
      return readStorageVolume(parent);
    return undefined;
  }
}
