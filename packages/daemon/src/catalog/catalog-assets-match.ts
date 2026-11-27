import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissingPathError } from "../util/is-missing-path-error.ts";

function hashFolder(path: string): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(path).toSorted()) {
    const child = join(path, name);
    const entry = lstatSync(child);
    hash.update(JSON.stringify(name));
    if (entry.isDirectory()) hash.update(`directory:${hashFolder(child)}`);
    else if (entry.isFile())
      hash.update(
        `file:${createHash("sha256").update(readFileSync(child)).digest("hex")}`,
      );
    else
      throw new Error(`Catalog asset contains a non-regular entry: ${child}`);
  }
  return hash.digest("hex");
}

export function catalogAssetsMatch(options: {
  source: string;
  target: string;
}) {
  const sourceHash = hashFolder(options.source);
  try {
    if (!lstatSync(options.target).isDirectory()) return false;
    return sourceHash === hashFolder(options.target);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}
