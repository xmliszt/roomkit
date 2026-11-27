import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";

export function getItemGenerationJob(options: {
  projectId: string;
  item: Item | undefined;
  jobs: Job[];
  messages: ChatMessage[];
}) {
  const item = options.item;
  if (!item) return undefined;
  const jobs = options.jobs.filter(
    (job) =>
      (job.kind === "generation" || job.kind === "generation-alternative") &&
      job.projectId === options.projectId &&
      job.itemId === item.id,
  );
  const latestGeneration = jobs
    .filter((job) => job.kind === "generation" && !job.superseded)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .at(0);
  const model = item.model;
  if (model.kind === "pending") {
    const original = jobs.find((job) => job.id === model.jobId);
    return latestGeneration &&
      latestGeneration.stage !== "ready" &&
      (!original || latestGeneration.createdAt > original.createdAt)
      ? latestGeneration
      : original;
  }
  const publication = options.messages.findLast(
    (message) =>
      message.blocks.some(
        (block) => block.kind === "asset" && block.assetId === model.assetId,
      ) &&
      message.blocks.some(
        (block) =>
          block.kind === "job" && jobs.some((job) => job.id === block.jobId),
      ),
  );
  if (publication) {
    const job = jobs.find((job) =>
      publication.blocks.some(
        (block) => block.kind === "job" && block.jobId === job.id,
      ),
    );
    if (
      latestGeneration &&
      latestGeneration.stage !== "ready" &&
      (!job || latestGeneration.createdAt > job.createdAt)
    )
      return latestGeneration;
    return job?.kind === "generation" ? job : undefined;
  }
  return latestGeneration;
}
