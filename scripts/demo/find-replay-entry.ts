import type { prepareReplay } from "./prepare-replay.ts";

/** Return the saved replay entry for a generation job: by replay job id or inventory object, else the late item whose name matches the job's. */
export function findReplayEntry(options: {
  entries: ReturnType<typeof prepareReplay>["entries"];
  jobId: string;
  job: { name?: string; reference?: { object?: { objectId?: string } } };
}) {
  return (
    options.entries.find(
      (entry) =>
        entry.replayJobId === options.jobId ||
        entry.objectId === options.job.reference?.object?.objectId,
    ) ??
    options.entries.find(
      (entry) => !entry.sourceObjectId && entry.item.name === options.job.name,
    )
  );
}
