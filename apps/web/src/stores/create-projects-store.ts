import type {
  Project,
  ProjectSummary,
} from "@planner/shared/src/project/project-schema.ts";
import { createStore } from "zustand/vanilla";

export function createProjectsStore() {
  return createStore<{
    summaries: ProjectSummary[];
    opened: { [projectId: string]: { project: Project; isStale: boolean } };
    ownRequestIds: { [projectId: string]: string[] };
    openErrors: { [projectId: string]: string };
  }>(() => ({ summaries: [], opened: {}, ownRequestIds: {}, openErrors: {} }));
}
