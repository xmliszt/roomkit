import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";

export function getGenerationAlternatives(options: {
  projectId: string;
  itemId: string;
  jobs: Job[];
  messages: ChatMessage[];
}) {
  const relevant = options.jobs
    .filter((job) => job.kind === "generation-alternative")
    .filter(
      (job) =>
        job.projectId === options.projectId && job.itemId === options.itemId,
    );
  function isRunning(job: Job) {
    return job.stage === "queued" || job.stage === "generating";
  }
  const jobs = ["trellis2", "sam3d"].flatMap((method) => {
    const job = relevant
      .filter((job) => job.method === method)
      .toSorted(
        (a, b) =>
          Number(isRunning(b)) - Number(isRunning(a)) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .at(0);
    return job ? [job] : [];
  });
  return {
    running: jobs.some(
      (job) => job.stage === "queued" || job.stage === "generating",
    ),
    errors: jobs.flatMap((job) =>
      job.stage === "failed"
        ? [
            {
              jobId: job.id,
              text: job.error,
              hasRejectedModel: job.hasRejectedModel === true,
            },
          ]
        : [],
    ),
    assets: options.messages
      .filter((message) =>
        message.blocks.some(
          (block) =>
            block.kind === "job" &&
            jobs.some((job) => job.id === block.jobId && job.stage === "ready"),
        ),
      )
      .flatMap((message) =>
        message.blocks.filter((block) => block.kind === "asset"),
      ),
  };
}
