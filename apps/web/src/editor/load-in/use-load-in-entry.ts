import { useCallback, useSyncExternalStore } from "react";
import type { createLoadIn } from "./create-load-in.ts";

export function useLoadInEntry(options: {
  loadIn: ReturnType<typeof createLoadIn> | undefined;
  itemId: string;
}) {
  const subscribe = useCallback(
    (listener: () => void) =>
      options.loadIn?.subscribe({ itemId: options.itemId, listener }) ??
      (() => {}),
    [options.loadIn, options.itemId],
  );
  const getSnapshot = useCallback(
    () => options.loadIn?.getEntry(options.itemId),
    [options.loadIn, options.itemId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
