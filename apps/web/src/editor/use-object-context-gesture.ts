import { useEffect, useRef } from "react";
import type { ObjectContextTarget } from "./object-context-target.ts";
import { viewportDragThresholdPx } from "./viewport-drag-threshold.ts";

export function useObjectContextGesture(options: {
  onOpen: (target: ObjectContextTarget) => void;
}) {
  const onOpenRef = useRef(options.onOpen);
  const gesture = useRef<{
    target: ObjectContextTarget;
    pointerId: number;
    button: number;
    isCancelled: boolean;
  }>(undefined);
  useEffect(() => {
    onOpenRef.current = options.onOpen;
  }, [options.onOpen]);
  useEffect(() => {
    function track(event: PointerEvent) {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (
        Math.hypot(
          event.clientX - current.target.xPx,
          event.clientY - current.target.yPx,
        ) >= viewportDragThresholdPx
      )
        current.isCancelled = true;
      if (!current.isCancelled && event.type === "pointermove")
        event.stopPropagation();
    }
    function release(event: PointerEvent) {
      if (
        event.button !== gesture.current?.button ||
        event.pointerId !== gesture.current?.pointerId
      )
        return;
      track(event);
      const current = gesture.current;
      gesture.current = undefined;
      if (current && !current.isCancelled)
        onOpenRef.current({
          ...current.target,
          xPx: event.clientX,
          yPx: event.clientY,
        });
    }
    function cancel() {
      gesture.current = undefined;
    }
    function handleKey(event: KeyboardEvent) {
      if (
        ["w", "a", "s", "d", "q", "e", "escape"].includes(
          event.key.toLowerCase(),
        )
      )
        cancel();
    }
    window.addEventListener("pointermove", track, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", handleKey);
    return () => {
      cancel();
      window.removeEventListener("pointermove", track, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);
  return function begin(input: { itemId: string; event: PointerEvent }) {
    gesture.current = {
      target: {
        itemId: input.itemId,
        xPx: input.event.clientX,
        yPx: input.event.clientY,
      },
      pointerId: input.event.pointerId,
      button: input.event.button,
      isCancelled: false,
    };
  };
}
