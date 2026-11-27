import type { ServerMessage } from "@planner/shared/src/protocol/server-message-schema.ts";
import type { createActivityStore } from "./create-activity-store.ts";
import { reduceChatEvent } from "./reduce-chat-event.ts";

export function applyActivityMessage(options: {
  store: ReturnType<typeof createActivityStore>;
  message: ServerMessage;
  now: () => string;
}) {
  const { store, message } = options;
  if (message.type === "snapshot") {
    store.setState((state) => ({
      chats: Object.fromEntries(
        Object.entries(state.chats)
          .filter(([id]) =>
            message.projects.some((project) => project.id === id),
          )
          .map(([id, history]) => [
            id,
            {
              ...history,
              isStale: true,
              version: history.version + 1,
              error: undefined,
            },
          ]),
      ),
      logs: {},
    }));
    return;
  }
  if (message.type !== "event") return;
  const event = message.event;
  store.setState((state) => {
    const history =
      "projectId" in event && Object.hasOwn(state.chats, event.projectId)
        ? state.chats[event.projectId]
        : undefined;
    const author =
      event.kind === "chat.message.added"
        ? event.message.author
        : "messageId" in event
          ? history?.messages.find((entry) => entry.id === event.messageId)
              ?.author
          : undefined;
    const jobId =
      event.kind === "job.updated"
        ? event.job.id
        : event.kind === "job.log"
          ? event.jobId
          : event.kind === "chat.block.set" && event.block.kind === "job"
            ? event.block.jobId
            : undefined;
    const events = [
      ...state.events,
      {
        id: state.eventCount,
        at: options.now(),
        event,
        role: author?.kind === "agent" ? author.role : undefined,
        jobId,
      },
    ].slice(-2000);
    const common = { events, eventCount: state.eventCount + 1 };
    switch (event.kind) {
      case "chat.message.added":
      case "chat.text.appended":
      case "chat.block.set":
      case "chat.message.finished":
        return {
          ...common,
          chats: {
            ...state.chats,
            [event.projectId]: reduceChatEvent({ history, event }),
          },
        };
      case "preflight.updated":
        return { ...common, preflight: event.preflight };
      case "job.log": {
        const previous = Object.hasOwn(state.logs, event.jobId)
          ? state.logs[event.jobId]
          : {};
        return {
          ...common,
          logs: {
            ...state.logs,
            [event.jobId]: Object.fromEntries(
              Object.entries({
                ...previous,
                ...Object.fromEntries(
                  event.lines.map((line, index) => [
                    event.firstLineIndex + index,
                    line,
                  ]),
                ),
              })
                .toSorted(([a], [b]) => Number(a) - Number(b))
                .slice(-2000),
            ),
          },
        };
      }
      case "project.removed":
        return {
          ...common,
          chats: Object.fromEntries(
            Object.entries(state.chats).filter(
              ([id]) => id !== event.projectId,
            ),
          ),
        };
      default:
        return common;
    }
  });
}
