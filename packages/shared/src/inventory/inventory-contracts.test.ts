import { expect, test } from "vitest";
import { JobSchema } from "../jobs/job-schema.ts";
import { ProjectSchema } from "../project/project-schema.ts";
import { ClientCommandSchema } from "../protocol/client-command-schema.ts";
import { InventorySubmitResultSchema } from "../protocol/inventory-submit-result-schema.ts";
import { createRectangularScene } from "../scene/create-rectangular-scene.ts";
import {
  type InventoryObject,
  InventoryObjectSchema,
} from "./inventory-object-schema.ts";
import { InventoryObjectsSchema } from "./inventory-objects-schema.ts";

const object = {
  objectId: "sofa",
  name: "Sofa",
  mount: "floor",
  bestPhotoId: "photo-1",
  views: [
    {
      photoId: "photo-1",
      box: [10, 20, 150, 200],
      visibility: "mostly-visible",
    },
    {
      photoId: "photo-2",
      box: [0, 30, 90, 180],
      visibility: "more-than-half-hidden",
    },
  ],
} satisfies InventoryObject;
const projectId = "00000000-0000-4000-8000-000000000001";
const turnId = "00000000-0000-4000-8000-000000000002";
const inventoryJob = {
  id: "inventory-1",
  kind: "inventory",
  projectId,
  reconstructionJobId: "reconstruction-1",
  stage: "segmenting",
  progress: 0.5,
  createdAt: "2026-11-23T00:00:00Z",
  updatedAt: "2026-11-23T00:00:01Z",
};

test("accepts a multi-view inventory and an empty submission", () => {
  expect(InventoryObjectsSchema.parse([object])).toEqual([object]);
  expect(
    ClientCommandSchema.parse({
      type: "agent.inventory.submit",
      projectId,
      turnId,
      objects: [],
    }),
  ).toMatchObject({ objects: [] });
  expect(InventorySubmitResultSchema.parse({ submitted: 0 })).toEqual({
    submitted: 0,
  });
});

test.each([
  { name: "duplicate object IDs", objects: [object, object] },
  {
    name: "duplicate photo IDs",
    objects: [{ ...object, views: [object.views[0], object.views[0]] }],
  },
  {
    name: "missing best photo",
    objects: [{ ...object, bestPhotoId: "photo-3" }],
  },
  { name: "no views", objects: [{ ...object, views: [] }] },
  {
    name: "agent-supplied sizes",
    objects: [{ ...object, sizeM: { width: 1, height: 1, depth: 1 } }],
  },
  {
    name: "agent-supplied placement",
    objects: [{ ...object, placement: { kind: "floor", xM: 0 } }],
  },
])("rejects $name", ({ objects }) => {
  expect(InventoryObjectsSchema.safeParse(objects).success).toBe(false);
});

test.each([
  [10, 20, 10, 200],
  [10, 20, 150, 20],
  [100, 20, 90, 200],
  [-1, 20, 150, 200],
  [0.5, 20, 150, 200],
  [0, 0, Number.POSITIVE_INFINITY, 200],
])("rejects an invalid box %j", (...box) => {
  expect(
    InventoryObjectSchema.safeParse({
      ...object,
      views: [{ ...object.views[0], box }],
    }).success,
  ).toBe(false);
});

test("inventory commands retain project and turn validation", () => {
  expect(
    ClientCommandSchema.parse({ type: "inventory.start", projectId }),
  ).toEqual({ type: "inventory.start", projectId });
  expect(
    ClientCommandSchema.safeParse({
      type: "agent.inventory.submit",
      projectId,
      turnId: "not-a-turn",
      objects: [object],
    }).success,
  ).toBe(false);
  expect(
    ClientCommandSchema.safeParse({
      type: "inventory.start",
      projectId,
      requestId: "not-a-request",
    }).success,
  ).toBe(false);
});

test("inventory jobs require their reconstruction and own stage vocabulary", () => {
  expect(JobSchema.parse(inventoryJob)).toEqual(inventoryJob);
  expect(
    JobSchema.safeParse({ ...inventoryJob, reconstructionJobId: undefined })
      .success,
  ).toBe(false);
  expect(
    JobSchema.safeParse({ ...inventoryJob, stage: "generating" }).success,
  ).toBe(false);
});

test("project receipts persist unique applied IDs without requiring live items", () => {
  const project = {
    id: projectId,
    name: "Room",
    revision: 0,
    scene: createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.8,
    }),
    inventory: { jobId: "inventory-1", appliedItemIds: ["deleted-item"] },
  };
  expect(ProjectSchema.parse(project)).toEqual(project);
  expect(
    ProjectSchema.safeParse({
      ...project,
      inventory: { jobId: "inventory-1", appliedItemIds: ["sofa", "sofa"] },
    }).success,
  ).toBe(false);
});

test("opening declarations belong only to wall inventory", () => {
  expect(
    InventoryObjectSchema.parse({
      ...object,
      mount: "wall",
      cutsOpening: true,
    }),
  ).toMatchObject({ cutsOpening: true });
  for (const mount of ["floor", "ceiling"])
    expect(
      InventoryObjectSchema.safeParse({ ...object, mount, cutsOpening: true })
        .success,
    ).toBe(false);
});

test("false opening declarations are omitted on every mount", () => {
  for (const mount of ["wall", "floor", "ceiling"])
    expect(
      InventoryObjectSchema.parse({ ...object, mount, cutsOpening: false }),
    ).toEqual({ ...object, mount });
});
