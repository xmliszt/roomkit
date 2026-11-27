import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import { useState } from "react";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { useJobTitle } from "./use-job-title.ts";

type RetryJobButtonProps = {
  job: Job;
  compact?: boolean;
  onError?: (error: string | undefined) => void;
};

export function RetryJobButton(props: RetryJobButtonProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const job = props.job;
  const title = useJobTitle(job);
  const isSuperseded = useStore(session.stores.jobs, (state) =>
    Object.values(state.jobs).some(
      (other) =>
        other.id !== job.id &&
        other.kind === job.kind &&
        other.createdAt > job.createdAt &&
        getRetryKey(other) === getRetryKey(job),
    ),
  );
  const request = (() => {
    if (job.stage !== "failed") return undefined;
    switch (job.kind) {
      case "generation":
        return {
          type: "generation.start",
          projectId: job.projectId,
          itemId: job.itemId,
        } satisfies ClientCommand;
      case "generation-alternative":
        return {
          type: "generation.alternatives",
          projectId: job.projectId,
          itemId: job.itemId,
          method: job.method,
        } satisfies ClientCommand;
      case "install":
        return {
          type: "install.start",
          target: job.target,
        } satisfies ClientCommand;
      case "bulb":
        return {
          type: "bulb.find",
          projectId: job.projectId,
          itemId: job.itemId,
        } satisfies ClientCommand;
      case "reconstruction":
      case "render":
      case "inventory":
      case "surface":
        return undefined;
      default: {
        const unreachable: never = job;
        return unreachable;
      }
    }
  })();
  async function retry() {
    if (!request) return;
    setBusy(true);
    setError(undefined);
    props.onError?.(undefined);
    try {
      const ack = await session.command(request);
      if (!ack.ok) throw new Error(ack.error);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      props.onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  if (!request || isSuperseded) return null;
  return (
    <span className="inline-flex flex-col gap-y-1">
      <button
        type="button"
        aria-label={t("jobs.retry-job-button.retry-title", { title: title })}
        disabled={busy}
        aria-busy={busy}
        onClick={(event) => {
          event.preventDefault();
          void retry();
        }}
        className={`${props.compact ? "h-6 px-1" : "min-h-7 px-2.5"} press whitespace-nowrap rounded-panel border border-line text-left text-danger hover:border-line-strong disabled:text-ink-dim`}
      >
        {busy && !props.compact
          ? t("jobs.retry-job-button.retrying")
          : t("jobs.retry-job-button.retry")}
      </button>
      {error && !props.onError && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

function getRetryKey(job: Job) {
  switch (job.kind) {
    case "generation":
      return job.itemId;
    case "generation-alternative":
      return `${job.itemId} ${job.method}`;
    case "install":
      return JSON.stringify(job.target);
    case "reconstruction":
    case "render":
    case "inventory":
      return job.projectId;
    case "surface":
      return job.surfaceId;
    case "bulb":
      return `bulb ${job.itemId}`;
    default: {
      const unreachable: never = job;
      return unreachable;
    }
  }
}
