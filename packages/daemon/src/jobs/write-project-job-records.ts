import { join } from "node:path";
import { writeJson } from "../util/write-json.ts";
import { readProjectJobRecords } from "./read-project-job-records.ts";

export function writeProjectJobRecords(options: {
  folder: string;
  kind:
    | "surface"
    | "reconstruction"
    | "inventory"
    | "generation"
    | "generation-alternative"
    | "bulb";
  records: { job: { kind: string } }[];
}) {
  writeJson({
    path: join(options.folder, ".planner", "jobs.json"),
    value: [
      ...readProjectJobRecords(options.folder).filter(
        (record) => record.job.kind !== options.kind,
      ),
      ...options.records,
    ],
  });
}
