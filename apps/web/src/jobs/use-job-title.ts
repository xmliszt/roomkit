import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { getJobTitle } from "./get-job-title.ts";

/** Return `getJobTitle` for `job`, reading names from its project when that project is open. */
export function useJobTitle(job: Job) {
  const session = usePlannerSession();
  const projectId = job.kind === "install" ? undefined : job.projectId;
  const project = useStore(session.stores.projects, (state) =>
    projectId !== undefined && Object.hasOwn(state.opened, projectId)
      ? state.opened[projectId]?.project
      : undefined,
  );
  return getJobTitle({ job, project, t: useMessages() });
}
