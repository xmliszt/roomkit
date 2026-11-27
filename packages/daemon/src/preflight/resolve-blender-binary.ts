import { join } from "node:path";

/** Return the Blender binary inside `path` when `path` is a `.app` bundle, and `path` unchanged otherwise. */
export function resolveBlenderBinary(path: string) {
  return path.replace(/\/+$/, "").endsWith(".app")
    ? join(path, "Contents", "MacOS", "Blender")
    : path;
}
