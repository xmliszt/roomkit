import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";

export type Emit = (event: PlannerEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Emit>();

  publish(event: PlannerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: Emit): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
