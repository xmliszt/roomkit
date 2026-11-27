import type { ChatMessage } from "@planner/shared/src/chat/chat-message-schema.ts";
import type { Preflight } from "@planner/shared/src/preflight/preflight-schema.ts";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { createStore } from "zustand/vanilla";

export type ChatHistory = {
  messages: ChatMessage[];
  isStale: boolean;
  version: number;
  error?: string | undefined;
};

export type EventLine = {
  id: number;
  at: string;
  event: PlannerEvent;
  role: string | undefined;
  jobId: string | undefined;
};

export type DiffUndoState =
  | { kind: "running" | "done" | "unknown"; completed: number }
  | { kind: "failed"; completed: number; error?: string };

export function createActivityStore() {
  return createStore<{
    chats: { [projectId: string]: ChatHistory };
    undos: { [blockKey: string]: DiffUndoState };
    events: EventLine[];
    eventCount: number;
    preflight: Preflight | undefined;
    logs: { [jobId: string]: { [lineIndex: string]: string } };
  }>(() => ({
    chats: {},
    undos: {},
    events: [],
    eventCount: 0,
    preflight: undefined,
    logs: {},
  }));
}
