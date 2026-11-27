"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getJobTitle } from "../jobs/get-job-title.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type LogPanelProps = { projectId: string };

export function LogPanel(props: LogPanelProps) {
  const t = useMessages();
  const locale = useLocale();
  const session = usePlannerSession();
  const events = useStore(session.stores.activity, (state) => state.events);
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const project = useStore(session.stores.projects, (state) =>
    Object.hasOwn(state.opened, props.projectId)
      ? state.opened[props.projectId]?.project
      : undefined,
  );
  const [jobId, setJobId] = useState("");
  const [role, setRole] = useState("");
  const shownJobs = Object.values(jobs).filter(
    (job) => job.kind === "install" || job.projectId === props.projectId,
  );
  const shownJobIds = new Set(shownJobs.map((job) => job.id));
  const shown = events.filter(
    (line) =>
      (!("projectId" in line.event) ||
        line.event.projectId === props.projectId) &&
      (line.event.kind !== "job.updated" ||
        line.event.job.kind === "install" ||
        line.event.job.projectId === props.projectId) &&
      (line.event.kind !== "job.log" || shownJobIds.has(line.event.jobId)) &&
      (!jobId || line.jobId === jobId) &&
      (!role || line.role === role),
  );
  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex gap-x-2">
        <select
          aria-label={t("activity.log.filter-job")}
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          className="min-w-0 flex-1 border border-line bg-bg p-1"
        >
          <option value="">{t("activity.log.all-jobs")}</option>
          {shownJobs.map((job) => (
            <option key={job.id} value={job.id}>
              {getJobTitle({ job, project, t })}
            </option>
          ))}
        </select>
        <select
          aria-label={t("activity.log.filter-role")}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="border border-line bg-bg p-1"
        >
          <option value="">{t("activity.log.all-roles")}</option>
          {["surveyor", "modeler", "designer"].map((value) => (
            <option key={value} value={value}>
              {t(`activity.log.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-ink-dim">
        {t(
          locale === "en" && shown.length === 1
            ? "activity.log.one-event"
            : "activity.log.event-count",
          { count: shown.length },
        )}
      </p>
      {shown.map((line) => (
        <details key={line.id} className="border-line border-b pb-2">
          <summary className="log-summary cursor-pointer text-[11px]">
            <span aria-hidden="true" className="disclosure-marker">
              ▸
            </span>
            <time className="text-ink-dim">
              {new Date(line.at).toLocaleTimeString(locale)}
            </time>
            <span className="log-kind">{line.event.kind}</span>
          </summary>
          <pre className="overflow-x-auto pt-2 text-[11px] text-ink-dim">
            {JSON.stringify(line.event, null, 2)}
          </pre>
        </details>
      ))}
      {shown.length === 0 && (
        <p className="text-ink-dim">{t("activity.log.no-events")}</p>
      )}
    </div>
  );
}
