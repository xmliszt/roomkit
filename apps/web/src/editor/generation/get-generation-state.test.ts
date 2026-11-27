import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { GenerationJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, it } from "vitest";
import { getGenerationState } from "./get-generation-state.ts";

const item: Item = {
  id: "chair",
  name: "Chair",
  model: { kind: "pending", jobId: "job" },
  placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
  sizeM: { width: 1, height: 1, depth: 1 },
  locked: false,
};

for (const stage of [
  "held",
  "queued",
  "generating",
  "failed",
  "ready",
] satisfies GenerationJob["stage"][]) {
  it(`keeps pending and existing asset actions consistent while ${stage}`, () => {
    const job: GenerationJob = {
      id: "job",
      kind: "generation",
      projectId: "project",
      itemId: item.id,
      stage,
      progress: 0,
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    };
    const pendingStates = {
      held: "held",
      queued: "running",
      generating: "running",
      failed: "failed",
      ready: "running",
    };
    const assetStates = {
      held: "ready",
      queued: "running",
      generating: "running",
      failed: "ready",
      ready: "ready",
    };
    expect(getGenerationState({ item, job })).toBe(pendingStates[stage]);
    expect(
      getGenerationState({
        item: { ...item, model: { kind: "asset", assetId: "chair-model" } },
        job,
      }),
    ).toBe(assetStates[stage]);
  });
}

it("offers modeling for a pending item without a job and ready actions for an asset", () => {
  expect(getGenerationState({ item, job: undefined })).toBe("held");
  expect(
    getGenerationState({
      item: { ...item, model: { kind: "asset", assetId: "chair-model" } },
      job: undefined,
    }),
  ).toBe("ready");
});

it("hides generation for every built-in charging port", () => {
  for (const port of CHARGING_PORT_TYPES)
    expect(
      getGenerationState({
        item: { ...item, model: { kind: "asset", assetId: port.assetId } },
        job: undefined,
      }),
    ).toBeUndefined();
});
