import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { SnapshotMessage } from "@planner/shared/src/protocol/snapshot-message-schema.ts";
import type { ProjectStore } from "../project/create-project-store.ts";

export function buildSnapshot(options: {
  config: Config;
  store: ProjectStore;
  jobs?: Job[];
}): SnapshotMessage {
  return {
    type: "snapshot",
    config: options.config,
    projects: options.store.listProjects(),
    jobs: options.jobs ?? [],
    at: new Date().toISOString(),
  };
}
