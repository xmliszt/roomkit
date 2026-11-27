"use client";

import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { useState } from "react";
import { getReconstructionText } from "../chat/get-reconstruction-text.ts";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { CancelJobButton } from "./cancel-job-button.tsx";
import { getJobStages } from "./get-job-stages.ts";
import { isJobRunning } from "./is-job-running.ts";
import { JobLog } from "./job-log.tsx";
import { RejectedModelThumbnail } from "./rejected-model-thumbnail.tsx";
import { RetryJobButton } from "./retry-job-button.tsx";
import { useJobTitle } from "./use-job-title.ts";

type JobRowProps = {
  job: Job;
  expanded?: boolean;
  onToggle?: () => void;
  logs?: boolean;
};

export function JobRow(props: JobRowProps) {
  const t = useMessages();
  const locale = useLocale();
  const job = props.job;
  const title = useJobTitle(job);
  const stages = getJobStages(job);
  const current = stages.indexOf(job.stage);
  const isRunning = isJobRunning(job);
  const isWaiting = job.waitingFor === "machine";
  const [actionError, setActionError] = useState<string>();
  const [manualOpen, setManualOpen] = useState<boolean>();
  const expanded = props.expanded ?? manualOpen ?? isRunning;
  return (
    <details
      open={expanded}
      onToggle={(event) => {
        if (event.currentTarget.open === expanded) return;
        if (props.onToggle) props.onToggle();
        else setManualOpen(event.currentTarget.open);
      }}
      className="border-line border-b py-3"
      data-job-id={job.id}
    >
      <summary className="job-summary cursor-pointer">
        <span aria-hidden="true" className="disclosure-marker">
          ▸
        </span>
        <span className="job-title" title={title}>
          {title}
        </span>
        <span className="job-action">
          <CancelJobButton job={job} onError={setActionError} compact />
          <RetryJobButton job={job} onError={setActionError} compact />
        </span>
        <span
          className={`job-stage ${job.stage === "failed" ? "text-danger" : isRunning ? "text-accent" : "text-ink-dim"}`}
          title={
            isWaiting
              ? t("jobs.job-row.waiting-for-the-machine")
              : t(`jobs.stage.${job.stage}`)
          }
        >
          {isWaiting ? t("jobs.job-row.waiting") : t(`jobs.stage.${job.stage}`)}
        </span>
        <span className="job-percent text-ink-dim">
          {new Intl.NumberFormat(locale, { style: "percent" }).format(
            job.progress,
          )}
        </span>
      </summary>
      <div className="flex flex-col gap-y-2 pt-3">
        {actionError && (
          <p role="alert" className="text-danger">
            {actionError}
          </p>
        )}
        {isWaiting && (
          <p className="text-ink-dim">
            {t("jobs.job-row.waiting-for-the-machine")}
          </p>
        )}
        {job.kind === "render" && job.startedAt && job.finishedAt && (
          <p className="text-ink-dim tabular-nums">
            {formatDecimal({
              value:
                (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000,
              locale,
              digits: 1,
            })}{" "}
            s
          </p>
        )}
        {!isWaiting && (
          <>
            <ol className="flex flex-wrap gap-x-3 gap-y-1">
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className={
                    job.stage === stage && isRunning
                      ? "text-accent"
                      : "text-ink-dim"
                  }
                >
                  <span aria-hidden="true">
                    {index < current ||
                    job.stage === "done" ||
                    job.stage === "ready"
                      ? "✓"
                      : index === current
                        ? "●"
                        : "○"}
                  </span>{" "}
                  {t(`jobs.stage.${stage}`)}
                </li>
              ))}
            </ol>
            <progress
              aria-label={t("jobs.job-row.title-progress", { title: title })}
              max={1}
              value={job.progress}
              className={`job-progress h-1.5 w-full ${isRunning ? "text-accent" : job.stage === "failed" ? "text-danger" : "text-ink"}`}
            />
          </>
        )}
        {job.error ? (
          <div className="flex min-w-0 items-center gap-x-2">
            {job.kind === "generation-alternative" && job.hasRejectedModel && (
              <RejectedModelThumbnail
                projectId={job.projectId}
                jobId={job.id}
              />
            )}
            <p role="alert" className="min-w-0 text-danger">
              {job.kind === "reconstruction"
                ? (getReconstructionText({ text: job.error, t }) ?? job.error)
                : job.error}
            </p>
          </div>
        ) : (
          <p className="break-words text-ink-dim">
            {job.lastLogLine ?? t("jobs.job-row.waiting-2")}
          </p>
        )}
        {expanded && props.logs !== false && <JobLog jobId={job.id} />}
      </div>
    </details>
  );
}
