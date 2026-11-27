import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PlannerSessionContext } from "../planner/planner-session-context.ts";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { BottomLeft } from "./bottom-left.tsx";

afterEach(cleanup);

function buildJob(options: { id?: string; stage?: "ready" | "queued" }) {
  return {
    id: options.id ?? "job",
    kind: "generation",
    projectId: "project",
    itemId: "item",
    stage: options.stage ?? "ready",
    progress: 1,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
  } satisfies Job;
}

function renderStatus(options: { jobs: Job[] }) {
  const onOpenJobs = vi.fn();
  const session = createPlannerSession({
    url: "ws://unused",
    createSocket() {
      throw new Error("This test never connects");
    },
  });
  render(
    <PlannerSessionContext.Provider value={session}>
      <BottomLeft
        sheetLabel="SHEET 01 · ROOM · 1:50"
        jobs={options.jobs}
        project={undefined}
        onOpenJobs={onOpenJobs}
      />
    </PlannerSessionContext.Provider>,
  );
  return { onOpenJobs };
}

test("the grid exposes ready and done counts without visible status text", () => {
  const { onOpenJobs } = renderStatus({
    jobs: [
      buildJob({}),
      { ...buildJob({ id: "room" }), kind: "reconstruction", stage: "done" },
      { ...buildJob({ id: "failed" }), stage: "failed" },
    ],
  });
  const grid = screen.getByRole("button", { name: "Jobs: 2 of 3 ready" });
  expect(screen.getByTestId("job-status").textContent).toBe(
    "SHEET 01 · ROOM · 1:50",
  );
  fireEvent.click(grid);
  expect(onOpenJobs).toHaveBeenCalledWith();
  fireEvent.click(screen.getByTitle("model · object · ready"));
  expect(onOpenJobs).toHaveBeenCalledWith("job");
  expect(document.querySelector("button button")).toBeNull();
});

test("an empty grid still opens Jobs without displaying no jobs", () => {
  const { onOpenJobs } = renderStatus({ jobs: [] });
  expect(screen.getByTestId("job-status").textContent).toBe(
    "SHEET 01 · ROOM · 1:50",
  );
  fireEvent.click(screen.getByRole("button", { name: "Jobs: 0 of 0 ready" }));
  expect(onOpenJobs).toHaveBeenCalledWith();
});

test("room progress retains priority over waiting and opens Jobs", () => {
  const { onOpenJobs } = renderStatus({
    jobs: [
      {
        ...buildJob({}),
        kind: "reconstruction",
        stage: "geometry",
        progress: 0.456,
      },
      {
        ...buildJob({ id: "waiting" }),
        stage: "generating",
        waitingFor: "machine",
      },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "geometry · 46%" }));
  expect(onOpenJobs).toHaveBeenCalledWith();
});

test("waiting remains visible and queued job cancel menus are siblings of grid buttons", () => {
  renderStatus({
    jobs: [
      {
        ...buildJob({ id: "waiting" }),
        stage: "generating",
        waitingFor: "machine",
      },
      buildJob({ stage: "queued" }),
    ],
  });
  expect(
    screen.getByRole("button", { name: "waiting for the machine" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Cancel model · object" }),
  ).toBeDefined();
  expect(document.querySelector("button button")).toBeNull();
});
