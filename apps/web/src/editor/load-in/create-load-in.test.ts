import {
  type Item,
  ItemSchema,
} from "@planner/shared/src/scene/item-schema.ts";
import { describe, expect, it, vi } from "vitest";
import { getAppearanceFrame } from "../generation/get-appearance-frame.ts";
import { createLoadIn } from "./create-load-in.ts";
import { LOAD_IN_TIMING } from "./load-in-timing.ts";

function fixture(count = 12) {
  const items = Array.from(
    { length: count },
    (_, index): Item => ({
      id: `item-${index}`,
      name: "Chair",
      model: { kind: "asset", assetId: "chair" },
      placement: {
        kind: "floor",
        xM: index,
        zM: 0,
        elevationM: 0,
        rotationRad: 0,
      },
      sizeM: { width: 1, height: 1, depth: 1 },
      locked: false,
    }),
  );
  const loadIn = createLoadIn(items);
  const visible = items.map((item, index) => ({
    itemId: item.id,
    distanceM: count - index,
  }));
  return {
    items,
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
    loadIn,
    visible,
  };
}

describe("load-in", () => {
  it("starts nearest first, spaces starts and waits for one of ten slots", () => {
    const input = fixture();
    for (const item of input.items)
      input.loadIn.ready({ itemId: item.id, readyAtMs: 0 });
    function advance(nowMs: number) {
      input.loadIn.advance({ ...input, nowMs, reduced: false });
    }
    advance(0);
    expect(input.loadIn.getEntry("item-11")?.kind).toBe("appearing");
    advance(79);
    expect(
      input.items
        .map((item) => input.loadIn.getEntry(item.id))
        .filter((entry) => entry?.kind === "appearing"),
    ).toHaveLength(1);
    for (let index = 1; index < 12; index++) advance(index * 80);
    expect(
      input.items
        .map((item) => input.loadIn.getEntry(item.id))
        .filter((entry) => entry?.kind === "appearing"),
    ).toHaveLength(10);
    input.loadIn.complete("item-11");
    advance(1200);
    expect(input.loadIn.getEntry("item-1")?.kind).toBe("appearing");
  });

  it("does not wait for unloaded or invisible items and never replays removed items", () => {
    const input = fixture(3);
    input.loadIn.ready({ itemId: "item-0", readyAtMs: 0 });
    input.loadIn.advance({ ...input, nowMs: 0, reduced: false });
    expect(input.loadIn.getEntry("item-0")?.kind).toBe("appearing");
    input.loadIn.ready({ itemId: "item-2", readyAtMs: 0 });
    input.loadIn.advance({ ...input, visible: [], nowMs: 80, reduced: false });
    expect(input.loadIn.getEntry("item-2")?.kind).toBe("waiting");
    input.loadIn.advance({
      ...input,
      itemsById: {},
      nowMs: 160,
      reduced: false,
    });
    for (const item of input.items)
      input.loadIn.ready({ itemId: item.id, readyAtMs: 0 });
    input.loadIn.advance({ ...input, nowMs: 240, reduced: false });
    expect(
      input.items
        .map((item) => input.loadIn.getEntry(item.id))
        .every((entry) => entry?.kind === "done"),
    ).toBe(true);
    expect(input.loadIn.getEntry("new-item")).toBeUndefined();
  });

  it("starts every reduced-motion item together and finishes the fade at 150 ms", () => {
    const input = fixture();
    for (const item of input.items)
      input.loadIn.ready({ itemId: item.id, readyAtMs: 0 });
    input.loadIn.advance({ ...input, nowMs: 0, reduced: true });
    expect(
      input.items
        .map((item) => input.loadIn.getEntry(item.id))
        .filter((entry) => entry?.kind === "appearing"),
    ).toHaveLength(12);
    expect(
      getAppearanceFrame({
        elapsedMs: 75,
        reduced: true,
        timing: LOAD_IN_TIMING,
      }),
    ).toMatchObject({ done: false, pointsOpacity: 0, modelOpacity: 0.5 });
    expect(
      getAppearanceFrame({
        elapsedMs: 150,
        reduced: true,
        timing: LOAD_IN_TIMING,
      }),
    ).toMatchObject({ done: true, pointsOpacity: 0, modelOpacity: 1 });
    expect(
      getAppearanceFrame({
        elapsedMs: 1199,
        reduced: false,
        timing: LOAD_IN_TIMING,
      }).done,
    ).toBe(false);
    expect(
      getAppearanceFrame({
        elapsedMs: 1200,
        reduced: false,
        timing: LOAD_IN_TIMING,
      }).done,
    ).toBe(true);
  });
  it("settles 25 items in 3920 ms with at most ten active", () => {
    const input = fixture(25);
    for (const item of input.items)
      input.loadIn.ready({ itemId: item.id, readyAtMs: 0 });
    let peak = 0;
    let completedAtMs = Infinity;
    for (let nowMs = 0; nowMs <= 5000; nowMs += 10) {
      for (const itemId of input.loadIn.getUnfinished()) {
        const entry = input.loadIn.getEntry(itemId);
        if (
          entry?.kind === "appearing" &&
          getAppearanceFrame({
            elapsedMs: nowMs - entry.startedAtMs,
            reduced: false,
            timing: LOAD_IN_TIMING,
          }).done
        )
          input.loadIn.complete(itemId);
      }
      input.loadIn.advance({ ...input, nowMs, reduced: false });
      peak = Math.max(
        peak,
        [...input.loadIn.getUnfinished()].filter(
          (id) => input.loadIn.getEntry(id)?.kind === "appearing",
        ).length,
      );
      if (!input.loadIn.getUnfinished().size) {
        completedAtMs = nowMs;
        break;
      }
    }
    expect(peak).toBe(10);
    expect(completedAtMs).toBe(3920);
  });

  it("finishes a replaced asset and never schedules its replacement", () => {
    const input = fixture(1);
    const item = input.items.at(0);
    if (!item) throw new Error("Missing item");
    input.loadIn.ready({ itemId: item.id, readyAtMs: 0 });
    input.loadIn.advance({
      ...input,
      itemsById: {
        [item.id]: {
          ...item,
          model: { kind: "asset", assetId: "replacement" },
        },
      },
      nowMs: 0,
      reduced: false,
    });
    expect(input.loadIn.getEntry(item.id)?.kind).toBe("done");
    input.loadIn.ready({ itemId: item.id, readyAtMs: 100 });
    input.loadIn.advance({ ...input, nowMs: 100, reduced: false });
    expect(input.loadIn.getUnfinished().size).toBe(0);
  });

  it("notifies only the changed item and releases shared data after the last item", async () => {
    const input = fixture(2);
    const listener = vi.fn();
    const unsubscribe = input.loadIn.subscribe({ itemId: "item-0", listener });
    const load = vi.fn(() => new Promise<never>(() => {}));
    const first = input.loadIn.loadData({ assetId: "chair", load });
    input.loadIn.complete("item-1");
    expect(listener).not.toHaveBeenCalled();
    expect(input.loadIn.loadData({ assetId: "chair", load })).toBe(first);
    const unmount = input.loadIn.mount("item-0");
    unmount();
    await Promise.resolve();
    expect(input.loadIn.getUnfinished().size).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
    expect(input.loadIn.loadData({ assetId: "chair", load })).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not finish an item during a strict-mode effect remount", async () => {
    const input = fixture(1);
    input.loadIn.mount("item-0")();
    input.loadIn.mount("item-0");
    await Promise.resolve();
    expect(input.loadIn.getEntry("item-0")?.kind).toBe("loading");
  });
  it.each(["constructor", "toString", "valueOf"])(
    "subscribes and caches safely for %s identifiers",
    (id) => {
      const original = fixture(1).items.at(0);
      const item = ItemSchema.parse({
        ...original,
        id,
        model: { kind: "asset", assetId: id },
      });
      const loadIn = createLoadIn([item]);
      const listener = vi.fn();
      const unsubscribe = loadIn.subscribe({ itemId: id, listener });
      const load = vi.fn(() => new Promise<never>(() => {}));
      const data = loadIn.loadData({ assetId: id, load });
      expect(loadIn.loadData({ assetId: id, load })).toBe(data);
      loadIn.ready({ itemId: id, readyAtMs: 0 });
      loadIn.complete(id);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(loadIn.loadData({ assetId: id, load })).not.toBe(data);
      unsubscribe();
    },
  );
});
