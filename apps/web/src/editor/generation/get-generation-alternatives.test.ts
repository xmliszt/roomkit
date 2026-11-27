import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import type { AlternativeJob } from "@planner/shared/src/jobs/job-schema.ts";
import { expect, it } from "vitest";
import { getGenerationAlternatives } from "./get-generation-alternatives.ts";

it("uses the latest pair for this project and item, and only offers completed assets", () => {
  const jobs: AlternativeJob[] = ["old", "ready", "failed", "other"].map(
    (id) => ({
      id,
      kind: "generation-alternative",
      method: id === "failed" ? "sam3d" : "trellis2",
      projectId: "project",
      itemId: id === "other" ? "other-item" : "item",
      stage: id === "failed" ? "failed" : "ready",
      progress: 1,
      error: id === "failed" ? "GLB validator found 2 errors" : undefined,
      hasRejectedModel: id === "failed" ? true : undefined,
      createdAt: id === "old" ? "2026-11-22T00:00:00Z" : "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    }),
  );
  const messages: ChatMessage[] = jobs.map((job) => ({
    id: job.id,
    author: { kind: "agent", role: "modeler" },
    status: "done",
    createdAt: job.createdAt,
    blocks: [
      { kind: "job", jobId: job.id },
      {
        kind: "asset",
        assetId: `asset-${job.id}`,
        name: "Chair",
        sizeM: { width: 1, height: 1, depth: 1 },
      },
    ],
  }));
  const result = getGenerationAlternatives({
    projectId: "project",
    itemId: "item",
    jobs,
    messages,
  });
  expect(result.assets.map((asset) => asset.assetId)).toEqual(["asset-ready"]);
  expect(result.errors).toEqual([
    {
      jobId: "failed",
      text: "GLB validator found 2 errors",
      hasRejectedModel: true,
    },
  ]);
  expect(result.running).toBe(false);
  expect(
    getGenerationAlternatives({
      projectId: "another-project",
      itemId: "item",
      jobs,
      messages,
    }).assets,
  ).toEqual([]);
  expect(
    getGenerationAlternatives({
      projectId: "project",
      itemId: "item",
      jobs: jobs.map((job) => ({ ...job, stage: "generating" })),
      messages,
    }).running,
  ).toBe(true);
});

it("retains an older active method while the other method has newer completed retries", () => {
  const jobs: AlternativeJob[] = ["active", "retry-1", "retry-2"].map(
    (id, index) => ({
      id,
      kind: "generation-alternative",
      method: id === "active" ? "sam3d" : "trellis2",
      projectId: "project",
      itemId: "item",
      stage: id === "active" ? "generating" : "ready",
      progress: 0.5,
      createdAt: `2026-11-23T0${index}:00:00Z`,
      updatedAt: `2026-11-23T0${index}:00:00Z`,
    }),
  );
  const result = getGenerationAlternatives({
    projectId: "project",
    itemId: "item",
    jobs,
    messages: [],
  });
  expect(result.running).toBe(true);
});
