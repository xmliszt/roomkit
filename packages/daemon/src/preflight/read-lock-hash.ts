import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PYTHON_ENV_MARKER = ".interior-planner.json";

/** Return the sha256 of `uv.lock` in `pythonProjectDir`. */
export function readLockHash(pythonProjectDir: string) {
  return createHash("sha256")
    .update(readFileSync(join(pythonProjectDir, "uv.lock")))
    .digest("hex");
}
