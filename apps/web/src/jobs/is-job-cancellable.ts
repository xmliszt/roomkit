import type { Job } from "@planner/shared/src/jobs/job-schema.ts";

/** `true` if `job.cancel` accepts `job` now; `false` when it is an install job or past the stages its kind can cancel in. */
export function isJobCancellable(job: Job) {
  if (job.kind === "install") return false;
  if (job.kind === "render")
    return ["queued", "exporting", "rendering"].includes(job.stage);
  if (job.kind === "bulb")
    return ["queued", "rendering", "asking"].includes(job.stage);
  return job.stage === "queued";
}
