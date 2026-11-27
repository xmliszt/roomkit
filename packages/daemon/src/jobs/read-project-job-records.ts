import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const RecordsSchema = z.array(
  z.object({ job: z.object({ kind: z.string() }).passthrough() }).passthrough(),
);

export function readProjectJobRecords(folder: string) {
  const path = join(folder, ".planner", "jobs.json");
  return existsSync(path)
    ? RecordsSchema.parse(JSON.parse(readFileSync(path, "utf8")))
    : [];
}
