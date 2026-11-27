"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { isJobRunning } from "./is-job-running.ts";
import { JobRow } from "./job-row.tsx";

type JobsPanelProps = {
  projectId?: string;
  selectedJobId?: string | undefined;
};

export function JobsPanel(props: JobsPanelProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const [opened, setOpened] = useState<{ [id: string]: boolean }>({});
  const shown = Object.values(jobs)
    .filter(
      (job) =>
        props.projectId === undefined ||
        job.kind === "install" ||
        job.projectId === props.projectId,
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (shown.length === 0)
    return (
      <p className="border-line border-b py-3 text-ink-dim">
        {t("jobs.jobs-panel.no-jobs-yet")}
      </p>
    );
  return (
    <div>
      {shown.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          expanded={
            (Object.hasOwn(opened, job.id) ? opened[job.id] : undefined) ??
            (job.id === props.selectedJobId || isJobRunning(job))
          }
          onToggle={() =>
            setOpened((current) => ({
              ...current,
              [job.id]: !(
                (Object.hasOwn(current, job.id)
                  ? current[job.id]
                  : undefined) ??
                (job.id === props.selectedJobId || isJobRunning(job))
              ),
            }))
          }
        />
      ))}
    </div>
  );
}
