import { createReadStream, realpathSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { JobRecordSchema } from "../reconstruction/job-record-schema.ts";
import { HttpError } from "./http-error.ts";

export async function readReconstructionPoints(options: {
  folder: string;
  jobId: string;
  response: ServerResponse;
}) {
  const path = (() => {
    try {
      if (!IdSchema.safeParse(options.jobId).success) return undefined;
      const record = readProjectJobRecords(options.folder)
        .map((value) => JobRecordSchema.safeParse(value))
        .find(
          (parsed) => parsed.success && parsed.data.job.id === options.jobId,
        );
      const stored = record?.data?.artifacts?.pointsPath;
      if (!stored) return undefined;
      const path = realpathSync(stored);
      const inside = relative(
        realpathSync(join(options.folder, "recon")),
        path,
      );
      const stat = statSync(path);
      if (
        inside.startsWith("..") ||
        isAbsolute(inside) ||
        !stat.isFile() ||
        stat.size !== 8000 * 6 * 4
      )
        return undefined;
      return path;
    } catch {
      return undefined;
    }
  })();
  if (!path) throw new HttpError({ status: 404, message: "Not found" });
  options.response.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": 8000 * 6 * 4,
    "x-content-type-options": "nosniff",
  });
  await pipeline(createReadStream(path), options.response);
}
