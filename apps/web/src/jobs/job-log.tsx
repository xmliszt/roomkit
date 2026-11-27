"use client";

import { JobLogResultSchema } from "@planner/shared/src/protocol/job-log-result-schema.ts";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type JobLogProps = { jobId: string };

export function JobLog(props: JobLogProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <JobLogRequest
      key={attempt}
      jobId={props.jobId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function JobLogRequest(props: JobLogProps & { onRetry: () => void }) {
  const t = useMessages();
  const session = usePlannerSession();
  const lines = useStore(session.stores.activity, (state) =>
    Object.hasOwn(state.logs, props.jobId)
      ? state.logs[props.jobId]
      : undefined,
  );
  const snapshotAt = useStore(session.stores.snapshot, (state) => state.at);
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (connection !== "open" || snapshotAt === undefined) return;
    let active = true;
    setError(undefined);
    session
      .command({ type: "job.log", jobId: props.jobId })
      .then((ack) => {
        if (!active) return;
        if (!ack.ok) throw new Error(ack.error);
        const result = JobLogResultSchema.parse(ack.result);
        session.stores.activity.setState((state) => ({
          logs: {
            ...state.logs,
            [props.jobId]: Object.fromEntries(
              Object.entries({
                ...Object.fromEntries(
                  result.lines.map((line, index) => [
                    result.firstLineIndex + index,
                    line,
                  ]),
                ),
                ...(Object.hasOwn(state.logs, props.jobId)
                  ? state.logs[props.jobId]
                  : {}),
              })
                .toSorted(([a], [b]) => Number(a) - Number(b))
                .slice(-2000),
            ),
          },
        }));
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [session, props.jobId, snapshotAt, connection]);
  return (
    <div className="flex flex-col gap-y-2">
      {error && (
        <p role="alert" className="text-danger">
          {error}{" "}
          <button type="button" onClick={props.onRetry} className="underline">
            {t("jobs.job-log.retry")}
          </button>
        </p>
      )}
      <pre
        role="log"
        aria-label={t("jobs.job-log.job-log")}
        className="max-h-48 overflow-auto border border-line p-2 text-[11px] text-ink-dim"
      >
        {lines === undefined
          ? t("jobs.job-log.waiting-for-log")
          : Object.entries(lines)
              .toSorted(([a], [b]) => Number(a) - Number(b))
              .map(([, line]) => line)
              .join("\n")}
      </pre>
    </div>
  );
}
