import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, it } from "vitest";
import { getItemGenerationJob } from "./get-item-generation-job.ts";

it("distinguishes a failed asset publication from a superseded generation after reload", () => {
  const item: Item = {
    id: "item",
    name: "Chair",
    model: { kind: "asset", assetId: "alternative" },
    sizeM: { width: 1, height: 1, depth: 1 },
    locked: false,
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
  };
  const common = {
    projectId: "project",
    itemId: "item",
    progress: 1,
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:00:00Z",
  };
  const jobs: Job[] = [
    { ...common, kind: "generation", id: "original", stage: "failed" },
    {
      ...common,
      kind: "generation-alternative",
      method: "trellis2",
      id: "alternative-job",
      stage: "ready",
    },
  ];
  const messages: ChatMessage[] = [
    {
      id: "alternative-job",
      author: { kind: "agent", role: "modeler" },
      status: "done",
      createdAt: common.createdAt,
      blocks: [
        { kind: "job", jobId: "alternative-job" },
        {
          kind: "asset",
          assetId: "alternative",
          name: "Chair",
          sizeM: item.sizeM,
        },
      ],
    },
  ];
  expect(
    getItemGenerationJob({ projectId: "project", item, jobs, messages }),
  ).toBeUndefined();
  const regeneration: Job = {
    ...common,
    kind: "generation",
    id: "regeneration",
    stage: "failed",
    createdAt: "2026-11-23T01:00:00Z",
    superseded: true,
    error: "The item uses another model",
  };
  expect(
    getItemGenerationJob({
      projectId: "project",
      item,
      jobs: [...jobs, regeneration],
      messages,
    }),
  ).toBeUndefined();
  expect(
    getItemGenerationJob({
      projectId: "project",
      item,
      jobs: [
        ...jobs,
        {
          ...regeneration,
          superseded: false,
          error: "Model proportions failed",
        },
      ],
      messages,
    })?.id,
  ).toBe("regeneration");
  expect(
    getItemGenerationJob({
      projectId: "project",
      item: { ...item, model: { kind: "asset", assetId: "prepared" } },
      jobs,
      messages,
    })?.id,
  ).toBe("original");
  expect(
    getItemGenerationJob({
      projectId: "project",
      item: { ...item, model: { kind: "pending", jobId: "original" } },
      jobs,
      messages,
    })?.id,
  ).toBe("original");
  expect(
    getItemGenerationJob({ projectId: "other-project", item, jobs, messages }),
  ).toBeUndefined();
});

it.each(["queued", "generating", "failed", "held"] satisfies Job["stage"][])(
  "shows a newer %s regeneration while keeping the previous model",
  (stage) => {
    const item: Item = {
      id: "item",
      name: "Chair",
      model: { kind: "asset", assetId: "original-model" },
      sizeM: { width: 1, height: 1, depth: 1 },
      locked: false,
      placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    };
    const original: Job = {
      id: "original",
      kind: "generation",
      projectId: "project",
      itemId: item.id,
      stage: "ready",
      progress: 1,
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    };
    const regeneration: Job = {
      ...original,
      id: "regeneration",
      stage,
      createdAt: "2026-11-23T01:00:00Z",
    };
    const messages: ChatMessage[] = [
      {
        id: original.id,
        author: { kind: "agent", role: "modeler" },
        status: "done",
        createdAt: original.createdAt,
        blocks: [
          { kind: "job", jobId: original.id },
          {
            kind: "asset",
            assetId: "original-model",
            name: item.name,
            sizeM: item.sizeM,
          },
        ],
      },
    ];
    for (const model of [
      item.model,
      { kind: "pending", jobId: original.id } satisfies Item["model"],
    ]) {
      expect(
        getItemGenerationJob({
          projectId: "project",
          item: { ...item, model },
          jobs: [original, regeneration],
          messages,
        })?.id,
      ).toBe(regeneration.id);
    }
  },
);

it("restores the failed pending job after undoing a completed regeneration", () => {
  const original: Job = {
    id: "original",
    kind: "generation",
    projectId: "project",
    itemId: "item",
    stage: "failed",
    progress: 0,
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:00:00Z",
  };
  expect(
    getItemGenerationJob({
      projectId: "project",
      item: {
        id: "item",
        name: "Chair",
        model: { kind: "pending", jobId: "original" },
        sizeM: { width: 1, height: 1, depth: 1 },
        locked: false,
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      },
      jobs: [
        original,
        {
          ...original,
          id: "regeneration",
          stage: "ready",
          createdAt: "2026-11-23T01:00:00Z",
        },
      ],
      messages: [],
    })?.id,
  ).toBe("original");
});
