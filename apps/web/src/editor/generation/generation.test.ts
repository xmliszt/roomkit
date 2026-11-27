import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraceLines } from "./create-trace-lines.ts";
import { getAppearanceFrame } from "./get-appearance-frame.ts";
import { getGenerationDisplays } from "./get-generation-displays.ts";
import { readSurfacePoints } from "./read-surface-points.ts";
import { readTraceLines } from "./read-trace-lines.ts";
import { reconcileGenerationEntries } from "./reconcile-generation-entries.ts";

function pendingItem(options: { id: string }): Item {
  return {
    id: options.id,
    name: "Sofa",
    model: { kind: "pending", jobId: `job-${options.id}` },
    sizeM: { width: 2, height: 1, depth: 1 },
    placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
    locked: false,
  };
}

describe("generation display queue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("animates up to the replay override at once", () => {
    vi.stubEnv("NEXT_PUBLIC_PLANNER_MAX_APPEARING", "5");
    const items = ["a", "b", "c", "d", "e", "f"].map((id) =>
      pendingItem({ id }),
    );
    const jobs = Object.fromEntries(
      items.map((item) => [
        `job-${item.id}`,
        {
          id: `job-${item.id}`,
          kind: "generation",
          projectId: "project",
          itemId: item.id,
          stage: "generating",
          progress: 0.5,
          createdAt: "2026-11-23T00:00:00Z",
          updatedAt: "2026-11-23T00:00:00Z",
        } satisfies Job,
      ]),
    );
    expect(
      getGenerationDisplays({
        entries: reconcileGenerationEntries({ entries: [], items }),
        items,
        jobs,
      }).map((entry) => entry.kind),
    ).toEqual([...Array(5).fill("generating"), "queued"]);
  });

  it("keeps occupied slots when an older held item begins generating", () => {
    const items = ["a", "b", "c", "d"].map((id) => pendingItem({ id }));
    const jobs = Object.fromEntries(
      items.map((item) => [
        `job-${item.id}`,
        {
          id: `job-${item.id}`,
          kind: "generation",
          projectId: "project",
          itemId: item.id,
          stage: item.id === "a" ? "queued" : "generating",
          progress: 0.5,
          createdAt: "2026-11-23T00:00:00Z",
          updatedAt: "2026-11-23T00:00:00Z",
        } satisfies Job,
      ]),
    );
    const entries = getGenerationDisplays({
      entries: reconcileGenerationEntries({ entries: [], items }),
      items,
      jobs,
    });
    expect(entries.map((entry) => entry.kind)).toEqual([
      "queued",
      "generating",
      "generating",
      "generating",
    ]);
    const first = jobs["job-a"];
    if (!first) throw new Error("Missing fixture");
    const next = getGenerationDisplays({
      entries,
      items,
      jobs: { ...jobs, "job-a": { ...first, stage: "generating" } },
    });
    expect(next.map((entry) => entry.kind)).toEqual([
      "queued",
      "generating",
      "generating",
      "generating",
    ]);
    expect(
      getGenerationDisplays({
        entries: next.filter((entry) => entry.itemId !== "b"),
        items,
        jobs: { ...jobs, "job-a": { ...first, stage: "generating" } },
      }).map((entry) => entry.kind),
    ).toEqual(["generating", "generating", "generating"]);
  });
  it("limits generating and ready items together to three and releases removed and failed items", () => {
    const items = ["a", "b", "c", "d"].map((id) => pendingItem({ id }));
    const jobs = Object.fromEntries(
      items.map((item) => [
        `job-${item.id}`,
        {
          id: `job-${item.id}`,
          kind: "generation",
          projectId: "project",
          itemId: item.id,
          stage: "generating",
          progress: 0.5,
          createdAt: "2026-11-23T00:00:00Z",
          updatedAt: "2026-11-23T00:00:00Z",
        } satisfies Job,
      ]),
    );
    const entries = reconcileGenerationEntries({ entries: [], items });
    expect(
      getGenerationDisplays({ entries, items, jobs }).map(
        (entry) => entry.kind,
      ),
    ).toEqual(["generating", "generating", "generating", "queued"]);
    const first = jobs["job-a"];
    if (!first) throw new Error("Missing fixture");
    expect(
      getGenerationDisplays({
        entries,
        items,
        jobs: { ...jobs, "job-a": { ...first, stage: "failed" } },
      }).map((entry) => entry.kind),
    ).toEqual(["failed", "generating", "generating", "generating"]);
    const remaining = items.filter((item) => item.id !== "a");
    expect(
      getGenerationDisplays({
        entries: reconcileGenerationEntries({ entries, items: remaining }),
        items: remaining,
        jobs,
      }).every((entry) => entry.kind === "generating"),
    ).toBe(true);
  });

  it("remembers placeholder size until completion, ignores assets on reload and tracks retry jobs", () => {
    const item = pendingItem({ id: "a" });
    const entries = reconcileGenerationEntries({ entries: [], items: [item] });
    const asset: Item = {
      ...item,
      model: { kind: "asset", assetId: "sofa" },
      sizeM: { width: 2, height: 0.8, depth: 0.9 },
    };
    expect(
      reconcileGenerationEntries({ entries, items: [asset] }).at(0)?.sizeM,
    ).toEqual(item.sizeM);
    expect(reconcileGenerationEntries({ entries: [], items: [asset] })).toEqual(
      [],
    );
    expect(
      reconcileGenerationEntries({
        entries,
        items: [{ ...item, model: { kind: "pending", jobId: "retry" } }],
      }).at(0)?.jobId,
    ).toBe("retry");
  });
});

it("traces part of a single segment and restores its endpoint without replacing buffers", () => {
  const trace = createTraceLines({
    positions: [0, 0, 0, 2, 0, 0, 2, 0, 0, 2, 4, 0],
    color: "#1b2430",
  });
  const ends = trace.line.geometry.getAttribute("instanceEnd");
  trace.setProgress(0.25);
  expect(trace.line.geometry.instanceCount).toBe(1);
  expect(ends.getX(0)).toBe(1);
  trace.setProgress(0.75);
  expect(ends.getX(0)).toBe(2);
  expect(ends.getY(1)).toBe(2);
  trace.setProgress(1);
  expect(ends.getY(1)).toBe(4);
  expect(trace.line.geometry.getAttribute("instanceEnd")).toBe(ends);
  trace.line.geometry.dispose();
  trace.line.material.dispose();
});

it("finishes with no points or material trace and uses only opacity for reduced motion", () => {
  expect(getAppearanceFrame({ elapsedMs: 2200, reduced: false })).toMatchObject(
    { done: true, pointsOpacity: 0, linesOpacity: 0, reveal: 1, boxOpacity: 0 },
  );
  expect(getAppearanceFrame({ elapsedMs: 100, reduced: true })).toMatchObject({
    done: false,
    pointsOpacity: 0,
    trace: 0,
    reveal: 1,
    modelOpacity: 0.5,
    boxOpacity: 0.5,
  });
  expect(getAppearanceFrame({ elapsedMs: 200, reduced: true }).done).toBe(true);
  expect(getAppearanceFrame({ elapsedMs: 1000, reduced: false }).reveal).toBe(
    0,
  );
});

it("reads little-endian sidecars with bounded point count and preserves ordered polyline segments", () => {
  const buffer = new ArrayBuffer(8000 * 24);
  const data = new DataView(buffer);
  for (let index = 0; index < 8000; index++) {
    data.setFloat32(index * 24, index, true);
    data.setFloat32(index * 24 + 12, 0.75, true);
  }
  const points = readSurfacePoints(buffer);
  expect(points.positions.length).toBe(5000 * 3);
  expect(points.colors.at(0)).toBe(0.75);
  expect(points.positions.at(-3)).toBe(7998);
  expect(() => readSurfacePoints(new ArrayBuffer(24))).toThrow();
  data.setFloat32(0, Number.NaN, true);
  expect(() => readSurfacePoints(buffer)).toThrow();
  const lines = new ArrayBuffer(44);
  const lineData = new DataView(lines);
  lineData.setUint32(0, 1, true);
  lineData.setUint32(4, 3, true);
  [0, 0, 0, 1, 0, 0, 1, 2, 0].forEach((value, index) => {
    lineData.setFloat32(8 + index * 4, value, true);
  });
  expect(readTraceLines(lines)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 0]);
  expect(() => readTraceLines(lines.slice(0, -1))).toThrow();
  expect(() => readTraceLines(new ArrayBuffer(0))).toThrow();
});

it("releases a tracked asset when its original generation fails after replacement", () => {
  const item = pendingItem({ id: "replaced" });
  const entries = reconcileGenerationEntries({ entries: [], items: [item] });
  expect(
    getGenerationDisplays({
      entries,
      items: [{ ...item, model: { kind: "asset", assetId: "alternative" } }],
      jobs: {
        "job-replaced": {
          id: "job-replaced",
          kind: "generation",
          projectId: "project",
          itemId: item.id,
          stage: "failed",
          progress: 0.5,
          createdAt: "2026-11-23T00:00:00Z",
          updatedAt: "2026-11-23T00:00:00Z",
        },
      },
    }),
  ).toEqual([]);
});
