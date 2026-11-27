import type { Job } from "@planner/shared/src/jobs/job-schema.ts";

export function getJobStages(job: Job) {
  switch (job.kind) {
    case "render":
      return ["queued", "exporting", "rendering", "done"];
    case "surface":
    case "generation":
    case "generation-alternative":
      return ["queued", "generating", "ready"];
    case "install":
      return ["queued", "running", "done"];
    case "bulb":
      return ["queued", "rendering", "asking", "done"];
    case "reconstruction":
      return ["queued", "intake", "geometry", "layout", "coverage", "done"];
    case "inventory":
      return [
        "queued",
        "surveying",
        "segmenting",
        "measuring",
        "applying",
        "done",
      ];
    default: {
      const unreachable: never = job;
      return unreachable;
    }
  }
}
