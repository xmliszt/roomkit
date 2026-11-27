import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { JobCancelResultSchema } from "@planner/shared/src/protocol/job-cancel-result-schema.ts";
import { useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { isJobCancellable } from "./is-job-cancellable.ts";
import { useJobTitle } from "./use-job-title.ts";

type CancelJobButtonProps = {
  job: Job;
  compact?: boolean;
  onError?: (error: string | undefined) => void;
};

export function CancelJobButton(props: CancelJobButtonProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = useJobTitle(props.job);
  async function cancel() {
    const job = props.job;
    if (job.kind === "install" || !isJobCancellable(job)) return;
    setBusy(true);
    setError(undefined);
    props.onError?.(undefined);
    try {
      const ack = await session.command({
        type: "job.cancel",
        projectId: job.projectId,
        jobId: job.id,
      });
      if (!ack.ok) throw new Error(ack.error);
      JobCancelResultSchema.parse(ack.result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      props.onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  if (!isJobCancellable(props.job)) return null;
  return (
    <span className="inline-flex flex-col gap-y-1">
      <button
        type="button"
        aria-label={t("jobs.cancel-job-button.cancel-title", { title: title })}
        disabled={busy}
        aria-busy={busy}
        onClick={(event) => {
          event.preventDefault();
          void cancel();
        }}
        className={`${props.compact ? "h-6 px-1" : "min-h-7 px-2.5"} press whitespace-nowrap rounded-panel border border-line text-left hover:border-line-strong disabled:text-ink-dim`}
      >
        {busy && !props.compact
          ? t("jobs.cancel-job-button.cancelling")
          : t("jobs.cancel-job-button.cancel")}
      </button>
      {error && !props.onError && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
