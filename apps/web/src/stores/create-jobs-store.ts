import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { createStore } from "zustand/vanilla";

export function createJobsStore() {
  return createStore<{ jobs: { [jobId: string]: Job } }>(() => ({ jobs: {} }));
}
