import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { GenerationJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { createJobsStore } from "../stores/create-jobs-store.ts";
import { createProjectsStore } from "../stores/create-projects-store.ts";
import { createSnapshotStore } from "../stores/create-snapshot-store.ts";
import { applyMessage } from "./apply-message.ts";

const projectId = "00000000-0000-4000-8000-000000000001";

function buildProject(): Project {
  return {
    id: projectId,
    name: "Living room",
    revision: 3,
    scene: createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.6,
    }),
  };
}

function buildJob(options: {
  stage: GenerationJob["stage"];
  progress: number;
}): GenerationJob {
  return {
    id: "job-1",
    kind: "generation",
    projectId,
    itemId: "sofa",
    stage: options.stage,
    progress: options.progress,
    createdAt: "2026-11-22T10:00:00.000Z",
    updatedAt: "2026-11-22T10:00:00.000Z",
  };
}

function createStores() {
  const stores = {
    snapshot: createSnapshotStore(),
    projects: createProjectsStore(),
    jobs: createJobsStore(),
  };
  stores.projects.setState({
    opened: { [projectId]: { project: buildProject(), isStale: false } },
  });
  return stores;
}

function sceneChanged(options: { revision: number; requestId?: string }) {
  return {
    kind: "scene.changed",
    projectId,
    command: { type: "room.update", ceilingHeightM: 2 + options.revision / 10 },
    revision: options.revision,
    ...(options.requestId === undefined
      ? {}
      : { requestId: options.requestId }),
  } satisfies PlannerEvent;
}

function opened(stores: ReturnType<typeof createStores>) {
  const entry = stores.projects.getState().opened[projectId];
  return {
    revision: entry?.project.revision,
    ceilingHeightM: entry?.project.scene.room.ceilingHeightM,
    isStale: entry?.isStale,
  };
}

test("a snapshot replaces the config, project list and jobs, and marks open projects stale", () => {
  const stores = createStores();
  stores.projects.setState({
    ownRequestIds: { [projectId]: ["11111111-1111-4111-8111-111111111111"] },
  });
  applyMessage({
    stores,
    message: {
      type: "snapshot",
      config: createDefaultConfig(),
      at: "2026-11-22T10:00:00.000Z",
      projects: [{ id: projectId, name: "Living room" }],
      jobs: [buildJob({ stage: "queued", progress: 0 })],
    },
  });
  expect(stores.snapshot.getState()).toMatchObject({
    config: { version: 1 },
    at: "2026-11-22T10:00:00.000Z",
  });
  expect(stores.projects.getState().summaries).toStrictEqual([
    { id: projectId, name: "Living room" },
  ]);
  expect(stores.projects.getState().ownRequestIds).toStrictEqual({});
  expect(opened(stores).isStale).toBe(true);
  expect(stores.jobs.getState().jobs["job-1"]?.stage).toBe("queued");
});

test("project.created adds the project once", () => {
  const stores = createStores();
  const event = {
    kind: "project.created",
    project: { id: projectId, name: "Living room" },
  } satisfies PlannerEvent;
  applyMessage({ stores, message: { type: "event", event } });
  applyMessage({ stores, message: { type: "event", event } });
  expect(stores.projects.getState().summaries).toStrictEqual([event.project]);
});

test("project.renamed renames the summary and the opened project", () => {
  const stores = createStores();
  stores.projects.setState({
    summaries: [{ id: projectId, name: "Living room" }],
  });
  const project = { id: projectId, name: "Den" };
  applyMessage({
    stores,
    message: { type: "event", event: { kind: "project.renamed", project } },
  });
  expect(stores.projects.getState().summaries).toStrictEqual([project]);
  expect(stores.projects.getState().opened[projectId]?.project.name).toBe(
    "Den",
  );
});

test("project.removed drops the summary, the opened project and its request ids", () => {
  const stores = createStores();
  stores.projects.setState({
    summaries: [{ id: projectId, name: "Living room" }],
    ownRequestIds: { [projectId]: ["11111111-1111-4111-8111-111111111111"] },
  });
  applyMessage({
    stores,
    message: { type: "event", event: { kind: "project.removed", projectId } },
  });
  expect(stores.projects.getState()).toStrictEqual({
    summaries: [],
    opened: {},
    ownRequestIds: {},
    openErrors: {},
  });
});

test("scene.changed from another client applies the command at the next revision", () => {
  const stores = createStores();
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 4 }) },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 4,
    ceilingHeightM: 2.4,
    isStale: false,
  });
});

test("scene.changed for this client's own request moves the revision and leaves the scene", () => {
  const stores = createStores();
  stores.projects.setState({
    ownRequestIds: {
      [projectId]: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
    },
  });
  applyMessage({
    stores,
    message: {
      type: "event",
      event: sceneChanged({
        revision: 4,
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 4,
    ceilingHeightM: 2.6,
    isStale: false,
  });
  expect(stores.projects.getState().ownRequestIds).toStrictEqual({
    [projectId]: ["22222222-2222-4222-8222-222222222222"],
  });
});

test("scene.changed that skips a revision marks the project stale, and an old one is ignored", () => {
  const stores = createStores();
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 3 }) },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 3,
    ceilingHeightM: 2.6,
    isStale: false,
  });
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 5 }) },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 3,
    ceilingHeightM: 2.6,
    isStale: true,
  });
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 4 }) },
  });
  expect(opened(stores).revision).toBe(3);
});

test("scene.changed for a project that is not open changes nothing", () => {
  const stores = createStores();
  const before = stores.projects.getState();
  applyMessage({
    stores,
    message: {
      type: "event",
      event: {
        ...sceneChanged({ revision: 4 }),
        projectId: "00000000-0000-4000-8000-000000000002",
      },
    },
  });
  expect(stores.projects.getState()).toBe(before);
});

test("job.updated replaces the job", () => {
  const stores = createStores();
  for (const job of [
    buildJob({ stage: "queued", progress: 0 }),
    buildJob({ stage: "generating", progress: 0.4 }),
  ])
    applyMessage({
      stores,
      message: { type: "event", event: { kind: "job.updated", job } },
    });
  expect(stores.jobs.getState().jobs).toStrictEqual({
    "job-1": buildJob({ stage: "generating", progress: 0.4 }),
  });
});

test("scene.changed from another client marks the project stale while an own request is pending", () => {
  const stores = createStores();
  stores.projects.setState({
    ownRequestIds: { [projectId]: ["11111111-1111-4111-8111-111111111111"] },
  });
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 4 }) },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 3,
    ceilingHeightM: 2.6,
    isStale: true,
  });
});

test("the echo of an own request on a stale project still clears its request id", () => {
  const stores = createStores();
  stores.projects.setState({
    ownRequestIds: { [projectId]: ["11111111-1111-4111-8111-111111111111"] },
  });
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 4 }) },
  });
  applyMessage({
    stores,
    message: {
      type: "event",
      event: sceneChanged({
        revision: 5,
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  });
  expect(opened(stores).isStale).toBe(true);
  expect(stores.projects.getState().ownRequestIds).toStrictEqual({
    [projectId]: [],
  });
});

test("an own request pending on one project does not mark another project stale", () => {
  const stores = createStores();
  stores.projects.setState({
    ownRequestIds: {
      "00000000-0000-4000-8000-000000000002": [
        "11111111-1111-4111-8111-111111111111",
      ],
    },
  });
  applyMessage({
    stores,
    message: { type: "event", event: sceneChanged({ revision: 4 }) },
  });
  expect(opened(stores)).toStrictEqual({
    revision: 4,
    ceilingHeightM: 2.4,
    isStale: false,
  });
});
