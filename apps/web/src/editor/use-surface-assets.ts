import {
  type SurfaceAsset,
  SurfaceAssetsResultSchema,
} from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { usePlannerSession } from "../planner/use-planner-session.ts";

export function useSurfaceAssets(projectId: string | undefined) {
  const session = usePlannerSession();
  const snapshotAt = useStore(session.stores.snapshot, (state) => state.at);
  const finished = useStore(session.stores.jobs, (state) =>
    Object.values(state.jobs)
      .filter(
        (job) =>
          job.kind === "surface" &&
          job.projectId === projectId &&
          job.stage === "ready",
      )
      .map((job) => `${job.id}:${job.updatedAt}`)
      .toSorted()
      .join(","),
  );
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${projectId}:${snapshotAt}:${finished}:${attempt}`;
  const [result, setResult] = useState<
    | {
        kind: "ready";
        projectId: string;
        requestKey: string;
        assets: SurfaceAsset[];
      }
    | {
        kind: "failed";
        projectId: string;
        requestKey: string;
        assets: SurfaceAsset[];
        error: string;
      }
  >();
  useEffect(() => {
    if (!projectId) return;
    let isActive = true;
    void session
      .command({ type: "surface.assets", projectId })
      .then((ack) => {
        if (!ack.ok) throw new Error(ack.error);
        const parsed = SurfaceAssetsResultSchema.parse(ack.result);
        if (isActive)
          setResult({
            kind: "ready",
            projectId,
            requestKey,
            assets: parsed.assets,
          });
      })
      .catch((error: unknown) => {
        if (isActive)
          setResult((current) => ({
            kind: "failed",
            projectId,
            requestKey,
            assets: current?.projectId === projectId ? current.assets : [],
            error:
              error instanceof Error
                ? error.message
                : "Could not load textures",
          }));
      });
    return () => {
      isActive = false;
    };
  }, [session, projectId, requestKey]);
  function retry() {
    setAttempt((current) => current + 1);
  }
  return {
    assets: result && result.projectId === projectId ? result.assets : [],
    error:
      result?.requestKey === requestKey && result.kind === "failed"
        ? result.error
        : undefined,
    isLoading: projectId !== undefined && result?.requestKey !== requestKey,
    retry,
  };
}
