import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createStore } from "zustand/vanilla";
import { PlannerSessionContext } from "../planner/planner-session-context.ts";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { applyActivityMessage } from "./apply-activity-message.ts";
import { LogPanel } from "./log-panel.tsx";

test("the open project shows its worker logs and global install logs only", () => {
  const session = createPlannerSession({
    url: "ws://127.0.0.1:1",
    createSocket() {
      throw new Error("This render must not open a socket");
    },
  });
  const now = () => "2026-11-23T00:00:00.000Z";
  const common = { progress: 0, createdAt: now(), updatedAt: now() };
  const jobs: Job[] = [
    {
      ...common,
      id: "project-a-job",
      kind: "generation",
      projectId: "project-a",
      itemId: "item-a",
      stage: "generating",
    },
    {
      ...common,
      id: "project-b-job",
      kind: "generation-alternative",
      projectId: "project-b",
      itemId: "item-b",
      method: "trellis2",
      stage: "generating",
    },
    {
      ...common,
      id: "install-job",
      kind: "install",
      target: { kind: "uv" },
      stage: "running",
    },
  ];
  session.stores.jobs.setState({
    jobs: Object.fromEntries(jobs.map((job) => [job.id, job])),
  });
  for (const job of jobs) {
    for (const event of [
      { kind: "job.updated", job },
      {
        kind: "job.log",
        jobId: job.id,
        firstLineIndex: 0,
        lines: [`${job.id} output`],
      },
    ] satisfies PlannerEvent[]) {
      applyActivityMessage({
        store: session.stores.activity,
        message: { type: "event", event },
        now,
      });
    }
  }
  const snapshotSession = {
    ...session,
    stores: {
      ...session.stores,
      activity: createStore(() => session.stores.activity.getState()),
      jobs: createStore(() => session.stores.jobs.getState()),
    },
  };
  function render(projectId: string) {
    return renderToStaticMarkup(
      createElement(
        PlannerSessionContext.Provider,
        { value: snapshotSession },
        createElement(LogPanel, { projectId }),
      ),
    );
  }
  const first = render("project-a");
  expect(first).toContain("project-a-job output");
  expect(first).toContain("install-job output");
  expect(first).not.toContain("project-b-job");
  const second = render("project-b");
  expect(second).toContain("project-b-job output");
  expect(second).toContain("install-job output");
  expect(second).not.toContain("project-a-job");
});
