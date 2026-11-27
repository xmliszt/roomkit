import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import { ROOM_RECONSTRUCTION_TIMING as timing } from "./room-reconstruction-timing.ts";

export type RoomReconstructionFrame = {
  stage: "waiting" | "points" | "floor" | "walls" | "fading" | "complete";
  floorProgress: number;
  height: number;
  opacity: number;
  pointsOpacity: number;
};

type Run = {
  jobId: string;
  roomKey: string;
  cloudAtMs: number | undefined;
  measuredAtMs: number | undefined;
};

export function createRoomReconstruction() {
  let run: Run | undefined;
  let lastJobId: string | undefined;
  function tick(input: {
    job: ReconstructionJob | undefined;
    roomKey: string;
    nowMs: number;
    cloud: "pending" | "ready" | "missing";
    reduced: boolean;
  }): RoomReconstructionFrame {
    const job = input.job;
    const complete: RoomReconstructionFrame = {
      stage: "complete",
      floorProgress: 1,
      height: 1,
      opacity: 1,
      pointsOpacity: 0,
    };
    if (!job) return complete;
    if (job.id !== lastJobId) {
      lastJobId = job.id;
      run = ["done", "failed", "cancelled"].includes(job.stage)
        ? undefined
        : {
            jobId: job.id,
            roomKey: input.roomKey,
            cloudAtMs: undefined,
            measuredAtMs: undefined,
          };
    }
    if (!run || job.stage === "failed" || job.stage === "cancelled") {
      run = undefined;
      return complete;
    }
    if (input.cloud === "ready" && run.cloudAtMs === undefined)
      run.cloudAtMs = input.nowMs;
    if (
      (input.roomKey !== run.roomKey || job.stage === "done") &&
      run.measuredAtMs === undefined &&
      (input.cloud !== "pending" || !job.pointCloudReady)
    )
      run.measuredAtMs = input.nowMs;
    const startMs =
      run.measuredAtMs === undefined
        ? Infinity
        : Math.max(
            run.measuredAtMs,
            (run.cloudAtMs ?? -Infinity) + timing.minimumCloudMs,
          );
    const elapsedMs =
      input.cloud === "pending" && job.pointCloudReady
        ? -1
        : input.nowMs - startMs;
    if (elapsedMs < 0)
      return {
        stage: input.cloud === "ready" ? "points" : "waiting",
        floorProgress: 0,
        height: 0,
        opacity: 0,
        pointsOpacity: input.cloud === "ready" ? 1 : 0,
      };
    function ease(value: number) {
      return 1 - (1 - Math.max(0, Math.min(1, value))) ** 3;
    }
    if (input.reduced) {
      const opacity = Math.max(0, Math.min(1, elapsedMs / timing.reducedMs));
      return {
        ...complete,
        stage: opacity < 1 ? "fading" : "complete",
        opacity,
        pointsOpacity: 1 - opacity,
      };
    }
    const height = ease((elapsedMs - timing.wallsAtMs) / timing.wallsMs);
    const pointsOpacity =
      1 - ease((elapsedMs - timing.pointsOutAtMs) / timing.pointsOutMs);
    return {
      stage:
        elapsedMs >= timing.pointsOutAtMs + timing.pointsOutMs
          ? "complete"
          : elapsedMs >= timing.pointsOutAtMs
            ? "fading"
            : elapsedMs >= timing.wallsAtMs
              ? "walls"
              : "floor",
      floorProgress: ease(elapsedMs / timing.floorMs),
      height,
      opacity: height > 0 ? 1 : 0,
      pointsOpacity,
    };
  }
  return { tick };
}
