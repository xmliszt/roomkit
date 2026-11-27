import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { usePlannerSession } from "../planner/use-planner-session.ts";

export function useReconstructionResult(options: {
  projectId: string;
  onOpenRoom: () => void;
}) {
  const session = usePlannerSession();
  const entry = useStore(
    session.stores.projects,
    (state) => state.opened[options.projectId],
  );
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const finished = Object.values(jobs)
    .filter(
      (job) =>
        job.kind === "reconstruction" &&
        job.projectId === options.projectId &&
        (job.stage === "done" || job.stage === "failed"),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .at(0);
  useEffect(() => {
    if (!finished) return;
    session.stores.projects.setState((state) => {
      const current = state.opened[options.projectId];
      if (!current || current.project.reconstruction?.jobId === finished.id)
        return state;
      return {
        opened: {
          ...state.opened,
          [options.projectId]: { ...current, isStale: true },
        },
      };
    });
  }, [session, options.projectId, finished]);
  const reconstruction = entry?.project.reconstruction;
  const shownJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      entry?.isStale !== false ||
      !reconstruction?.weakScale ||
      session.stores.projects.getState().opened[options.projectId]?.isStale
    )
      return;
    const key = `planner-scale-reviewed:${options.projectId}:${reconstruction.jobId}`;
    if (shownJob.current === key) return;
    shownJob.current = key;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "true");
    } catch {}
    options.onOpenRoom();
  }, [
    session,
    options.projectId,
    options.onOpenRoom,
    entry?.isStale,
    reconstruction?.jobId,
    reconstruction?.weakScale,
  ]);
}
