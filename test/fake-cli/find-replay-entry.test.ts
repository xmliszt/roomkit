import { expect, it } from "vitest";
import { findReplayEntry } from "../../scripts/demo/find-replay-entry.ts";
import type { prepareReplay } from "../../scripts/demo/prepare-replay.ts";

type Entry = ReturnType<typeof prepareReplay>["entries"][number];

function entry(options: {
  objectId: string;
  name: string;
  sourceObjectId?: string;
}) {
  return {
    objectId: options.objectId,
    sourceObjectId: options.sourceObjectId,
    replayJobId: `job-${options.objectId}`,
    generation: undefined,
    catalog: false,
    item: {
      id: options.objectId,
      name: options.name,
      model: { kind: "asset", assetId: `asset-${options.objectId}` },
      sizeM: { width: 1, height: 1, depth: 1 },
      placement: {
        kind: "floor",
        xM: 0,
        zM: 0,
        elevationM: 0,
        rotationRad: 0,
      },
      locked: false,
    },
  } satisfies Entry;
}

const entries = [
  entry({ objectId: "sofa", name: "Lamp", sourceObjectId: "source-sofa" }),
  entry({ objectId: "lamp", name: "Lamp" }),
];

it("finds by replay job id, then inventory object, then the late item's name", () => {
  expect(
    findReplayEntry({ entries, jobId: "job-sofa", job: {} })?.objectId,
  ).toBe("sofa");
  expect(
    findReplayEntry({
      entries,
      jobId: "other",
      job: { reference: { object: { objectId: "lamp" } } },
    })?.objectId,
  ).toBe("lamp");
  expect(
    findReplayEntry({ entries, jobId: "other", job: { name: "Lamp" } })
      ?.objectId,
  ).toBe("lamp");
  expect(
    findReplayEntry({ entries, jobId: "other", job: { name: "Chair" } }),
  ).toBeUndefined();
});
