import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { AppearanceData } from "../generation/appearance-data.ts";
import { LOAD_IN_TIMING } from "./load-in-timing.ts";

type Entry = { assetId: string; readyAtMs?: number } & (
  | { kind: "loading" }
  | { kind: "waiting" }
  | { kind: "appearing"; startedAtMs: number }
  | { kind: "done" }
);

export function createLoadIn(items: Item[]) {
  const entries: { [itemId: string]: Entry } = Object.fromEntries(
    items.flatMap((item) =>
      item.model.kind === "asset"
        ? [[item.id, { assetId: item.model.assetId, kind: "loading" }]]
        : [],
    ),
  );
  const unfinished = new Set(Object.keys(entries));
  const mounted = new Set<string>();
  const listeners: { [itemId: string]: Set<() => void> } = Object.create(null);
  const data: { [assetId: string]: Promise<AppearanceData> } =
    Object.create(null);
  let lastStartedAtMs = -Infinity;

  function getEntry(itemId: string) {
    return Object.hasOwn(entries, itemId) ? entries[itemId] : undefined;
  }

  function update(options: { itemId: string; entry: Entry }) {
    entries[options.itemId] = options.entry;
    for (const listener of listeners[options.itemId] ?? []) listener();
  }

  function complete(itemId: string) {
    const entry = getEntry(itemId);
    if (!entry || entry.kind === "done") return;
    unfinished.delete(itemId);
    if (![...unfinished].some((id) => getEntry(id)?.assetId === entry.assetId))
      delete data[entry.assetId];
    update({ itemId, entry: { ...entry, kind: "done" } });
  }

  return {
    getEntry,
    getUnfinished: () => unfinished,
    mount(itemId: string) {
      mounted.add(itemId);
      return () => {
        mounted.delete(itemId);
        queueMicrotask(() => {
          if (!mounted.has(itemId)) complete(itemId);
        });
      };
    },
    subscribe(options: { itemId: string; listener: () => void }) {
      const itemListeners = listeners[options.itemId] ?? new Set();
      listeners[options.itemId] = itemListeners;
      itemListeners.add(options.listener);
      return () => {
        itemListeners.delete(options.listener);
        if (!itemListeners.size) delete listeners[options.itemId];
      };
    },
    loadData(options: {
      assetId: string;
      load: () => Promise<AppearanceData>;
    }) {
      const existing = Object.hasOwn(data, options.assetId)
        ? data[options.assetId]
        : undefined;
      if (existing) return existing;
      const loaded = options.load();
      if (
        [...unfinished].some((id) => getEntry(id)?.assetId === options.assetId)
      )
        data[options.assetId] = loaded;
      return loaded;
    },
    ready(options: { itemId: string; readyAtMs: number }) {
      const entry = getEntry(options.itemId);
      if (entry?.kind === "loading")
        update({
          itemId: options.itemId,
          entry: { ...entry, kind: "waiting", readyAtMs: options.readyAtMs },
        });
    },
    complete,
    advance(options: {
      nowMs: number;
      reduced: boolean;
      itemsById: { [itemId: string]: Item };
      visible: { itemId: string; distanceM: number }[];
    }) {
      for (const itemId of unfinished) {
        const entry = getEntry(itemId);
        const item = options.itemsById[itemId];
        if (
          item?.model.kind !== "asset" ||
          item.model.assetId !== entry?.assetId
        )
          complete(itemId);
      }
      const active = [...unfinished].filter(
        (itemId) => getEntry(itemId)?.kind === "appearing",
      ).length;
      if (
        !options.reduced &&
        (active >= LOAD_IN_TIMING.maxAnimating ||
          options.nowMs - lastStartedAtMs < LOAD_IN_TIMING.staggerMs)
      )
        return;
      const waiting = options.visible
        .filter(({ itemId }) => getEntry(itemId)?.kind === "waiting")
        .toSorted((a, b) => a.distanceM - b.distanceM);
      for (const candidate of options.reduced ? waiting : waiting.slice(0, 1)) {
        const entry = getEntry(candidate.itemId);
        if (!entry) continue;
        lastStartedAtMs = options.nowMs;
        update({
          itemId: candidate.itemId,
          entry: { ...entry, kind: "appearing", startedAtMs: options.nowMs },
        });
      }
    },
  };
}
