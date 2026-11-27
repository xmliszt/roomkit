import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { expect, test } from "vitest";
import type { ToolContext } from "../tool-context.ts";
import { jobStatus } from "./job-status.ts";

const projectId = "00000000-0000-4000-8000-000000000001";
const common = {
  id: "job-1",
  progress: 0.3,
  createdAt: "2026-11-23T00:00:00Z",
  updatedAt: "2026-11-23T00:00:01Z",
};
const inventory = {
  ...common,
  kind: "inventory",
  projectId,
  reconstructionJobId: "reconstruction-1",
  stage: "measuring",
} satisfies Job;

function buildContext(options: { job: Job }) {
  return {
    projectId,
    turnId: "00000000-0000-4000-8000-000000000002",
    link: {
      request: async () => ({ ok: false }),
      readJob: () => options.job,
      close() {},
    },
  } satisfies ToolContext;
}

test("reads an inventory job belonging to the current project", async () => {
  expect(
    await jobStatus.call(
      { jobId: inventory.id },
      buildContext({ job: inventory }),
    ),
  ).toEqual(inventory);
});

test.each([
  {
    ...inventory,
    projectId: "00000000-0000-4000-8000-000000000003",
  },
  {
    ...common,
    kind: "install",
    target: { kind: "uv" },
    stage: "running",
  },
] satisfies Job[])("refuses jobs outside the project", async (job) => {
  await expect(
    jobStatus.call({ jobId: job.id }, buildContext({ job })),
  ).rejects.toThrow("Unknown job");
});
