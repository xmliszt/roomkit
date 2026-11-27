import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import type { createSnapshotStore } from "../stores/create-snapshot-store.ts";
import type { createWsClient } from "../ws/ws-client.ts";
import type { createActivityStore } from "./create-activity-store.ts";

export function createChatSync(options: {
  activity: ReturnType<typeof createActivityStore>;
  snapshot: ReturnType<typeof createSnapshotStore>;
  command: ReturnType<typeof createWsClient>["command"];
}) {
  const watched: { [projectId: string]: number } = {};
  const pending: { [projectId: string]: boolean } = {};
  let unsubscribe: (() => void) | undefined;
  let unsubscribeSnapshot: (() => void) | undefined;

  function refresh(projectId: string) {
    const history = options.activity.getState().chats[projectId];
    if (
      !watched[projectId] ||
      pending[projectId] ||
      history?.error ||
      !history?.isStale ||
      options.snapshot.getState().connection !== "open"
    )
      return;
    pending[projectId] = true;
    const version = history.version;
    options
      .command({ type: "chat.history", projectId })
      .then((ack) => {
        if (!ack.ok) throw new Error(ack.error);
        const { messages } = ChatHistoryResultSchema.parse(ack.result);
        options.activity.setState((state) => {
          const current = state.chats[projectId];
          if (current === undefined || current.version !== version)
            return state;
          return {
            chats: {
              ...state.chats,
              [projectId]: { messages, version, isStale: false },
            },
          };
        });
      })
      .catch((error: unknown) => {
        options.activity.setState((state) => {
          const current = state.chats[projectId];
          if (current === undefined || current.version !== version)
            return state;
          return {
            chats: {
              ...state.chats,
              [projectId]: {
                ...current,
                error: error instanceof Error ? error.message : String(error),
              },
            },
          };
        });
      })
      .finally(() => {
        delete pending[projectId];
        refresh(projectId);
      });
  }

  function refreshWatched() {
    for (const id of Object.keys(watched)) refresh(id);
  }

  return {
    start() {
      unsubscribe ??= options.activity.subscribe(refreshWatched);
      unsubscribeSnapshot ??= options.snapshot.subscribe(refreshWatched);
      refreshWatched();
    },
    stop() {
      unsubscribe?.();
      unsubscribeSnapshot?.();
      unsubscribe = undefined;
      unsubscribeSnapshot = undefined;
    },
    retry(projectId: string) {
      options.activity.setState((state) => ({
        chats: {
          ...state.chats,
          [projectId]: {
            messages: [],
            version: 0,
            ...state.chats[projectId],
            isStale: true,
            error: undefined,
          },
        },
      }));
    },
    watch(projectId: string) {
      watched[projectId] = (watched[projectId] ?? 0) + 1;
      options.activity.setState((state) => ({
        chats: {
          ...state.chats,
          [projectId]: state.chats[projectId] ?? {
            messages: [],
            isStale: true,
            version: 0,
          },
        },
      }));
      refresh(projectId);
      return () => {
        watched[projectId] = Math.max(0, (watched[projectId] ?? 1) - 1);
      };
    },
  };
}
