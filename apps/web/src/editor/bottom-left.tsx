import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { CancelJobButton } from "../jobs/cancel-job-button.tsx";
import { getJobTitle } from "../jobs/get-job-title.ts";
import { isJobCancellable } from "../jobs/is-job-cancellable.ts";
import { isJobRunning } from "../jobs/is-job-running.ts";

type BottomLeftProps = {
  sheetLabel: string;
  jobs: Job[];
  project: Project | undefined;
  onOpenJobs: (jobId?: string) => void;
};

export function BottomLeft(props: BottomLeftProps) {
  const t = useMessages();
  const waitingJob = props.jobs.find(
    (job) => isJobRunning(job) && job.waitingFor === "machine",
  );
  const roomJob = props.jobs.find(
    (job) =>
      (job.kind === "reconstruction" || job.kind === "inventory") &&
      job.stage !== "done" &&
      job.stage !== "failed" &&
      job.stage !== "cancelled",
  );
  return (
    <div
      data-testid="job-status"
      className="absolute z-control has-[.group:hover]:z-popover has-[:focus-visible]:z-popover bottom-4 left-4 flex flex-col items-start gap-y-1.5"
    >
      <div data-chrome className="flex items-center gap-x-2">
        <div className="relative flex min-h-2.5 min-w-2.5 max-w-32 flex-wrap gap-x-1 gap-y-1">
          <button
            type="button"
            aria-label={t("editor.bottom-left.jobs-length-of-length2-ready", {
              length: props.jobs.filter(
                (job) => job.stage === "ready" || job.stage === "done",
              ).length,
              length2: props.jobs.length,
            })}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.onOpenJobs()}
            className="absolute inset-0"
          />
          {props.jobs.map((job) => (
            <div key={job.id} className="group relative flex items-center">
              <button
                type="button"
                aria-label={t("editor.bottom-left.open-job", {
                  job: getJobTitle({ job, project: props.project, t }),
                })}
                title={`${getJobTitle({ job, project: props.project, t })} · ${isJobRunning(job) && job.waitingFor === "machine" ? t("jobs.job-row.waiting-for-the-machine") : t(`jobs.stage.${job.stage}`)}`}
                onClick={() => props.onOpenJobs(job.id)}
                className={`size-2.5 border ${isJobRunning(job) ? "border-accent bg-accent-soft" : job.stage === "failed" ? "border-danger" : job.stage === "done" || job.stage === "ready" ? "border-ink bg-ink" : "border-line-strong"}`}
              />
              {isJobCancellable(job) && (
                <div className="invisible absolute bottom-full left-0 z-popover pb-2 group-hover:visible group-focus-within:visible">
                  <div className="whitespace-nowrap rounded-panel border border-line bg-bg p-1">
                    <CancelJobButton job={job} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {(roomJob || waitingJob) && (
          <button
            type="button"
            data-chrome
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.onOpenJobs()}
            className="text-ink-dim tabular-nums hover:text-ink"
          >
            {roomJob
              ? `${t(`jobs.stage.${roomJob.stage}`)} · ${Math.round(roomJob.progress * 100)}%`
              : t("editor.bottom-left.waiting-for-the-machine")}
          </button>
        )}
      </div>
      <div
        data-chrome
        title={props.sheetLabel}
        className="type-label max-w-[40vw] truncate"
      >
        {props.sheetLabel}
      </div>
    </div>
  );
}
