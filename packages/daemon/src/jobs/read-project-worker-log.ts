import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";

export async function readProjectWorkerLog(options: {
  projectFolder: string;
  job: Exclude<Job, { kind: "install" }>;
}) {
  const category = (() => {
    switch (options.job.kind) {
      case "render":
        return "render";
      case "generation":
      case "generation-alternative":
        return "generation";
      case "surface":
        return "surfaces";
      case "inventory":
        return "inventory";
      case "reconstruction":
        return "reconstruction";
      case "bulb":
        return "bulbs";
      default: {
        const unreachable: never = options.job;
        return unreachable;
      }
    }
  })();
  const path = join(
    options.projectFolder,
    ".planner",
    category,
    options.job.id,
    "worker.log",
  );
  if (!existsSync(path)) return { firstLineIndex: 0, lines: [] };
  const stream = createReadStream(path);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  let lineCount = 0;
  try {
    for await (const line of reader) {
      lines[lineCount % 2000] = line;
      lineCount += 1;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  const offset = lineCount % 2000;
  return {
    firstLineIndex: Math.max(0, lineCount - 2000),
    lines:
      lineCount <= 2000
        ? lines
        : [...lines.slice(offset), ...lines.slice(0, offset)],
  };
}
