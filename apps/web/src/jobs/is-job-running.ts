import type { Job } from "@planner/shared/src/jobs/job-schema.ts";

export function isJobRunning(job: Job) {
  switch (job.kind) {
    case "render":
      return job.stage === "exporting" || job.stage === "rendering";
    case "surface":
    case "generation":
    case "generation-alternative":
      return job.stage === "generating";
    case "install":
      return job.stage === "running";
    case "bulb":
      return job.stage === "rendering" || job.stage === "asking";
    case "reconstruction":
      return (
        job.stage === "intake" ||
        job.stage === "geometry" ||
        job.stage === "layout" ||
        job.stage === "coverage"
      );
    case "inventory":
      return (
        job.stage === "surveying" ||
        job.stage === "segmenting" ||
        job.stage === "measuring" ||
        job.stage === "applying"
      );
    default: {
      const unreachable: never = job;
      return unreachable;
    }
  }
}
