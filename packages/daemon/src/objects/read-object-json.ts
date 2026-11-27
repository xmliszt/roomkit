import { readFileSync } from "node:fs";
import { jobFilePath } from "../generation/job-file-path.ts";

export function readObjectJson(options: { folder: string; path: string }) {
  try {
    const value: unknown = JSON.parse(
      readFileSync(jobFilePath(options), "utf8"),
    );
    return value;
  } catch {
    return undefined;
  }
}
