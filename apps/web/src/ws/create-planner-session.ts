import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { applyActivityMessage } from "../activity/apply-activity-message.ts";
import { createActivityStore } from "../activity/create-activity-store.ts";
import { createChatSync } from "../activity/create-chat-sync.ts";
import { createDiffUndo } from "../chat/create-diff-undo.ts";
import { createJobsStore } from "../stores/create-jobs-store.ts";
import { createProjectsStore } from "../stores/create-projects-store.ts";
import { createSnapshotStore } from "../stores/create-snapshot-store.ts";
import { applyMessage } from "./apply-message.ts";
import { createWsClient } from "./ws-client.ts";

/** Return the stores, the socket client and the project-open and scene-command helpers for one browser tab; nothing connects until `start`. */
export function createPlannerSession(options: {
  url: string;
  createSocket: (url: string) => WebSocket;
}) {
  const stores = {
    snapshot: createSnapshotStore(),
    projects: createProjectsStore(),
    jobs: createJobsStore(),
    activity: createActivityStore(),
  };
  const client = createWsClient({
    url: options.url,
    createSocket: options.createSocket,
    onMessage(message) {
      applyMessage({ stores, message });
      applyActivityMessage({
        store: stores.activity,
        message,
        now: () => new Date().toISOString(),
      });
      if (message.type === "snapshot") {
        stores.projects.setState({ openErrors: {} });
      }
    },
    onConnection: (connection) => stores.snapshot.setState({ connection }),
  });
  const chatSync = createChatSync({
    activity: stores.activity,
    snapshot: stores.snapshot,
    command: client.command,
  });
  const watched: { [projectId: string]: number } = {};
  const opening: { [projectId: string]: true } = {};

  function markStale(projectId: string) {
    stores.projects.setState((state) => {
      const entry = state.opened[projectId];
      return entry === undefined
        ? state
        : {
            opened: {
              ...state.opened,
              [projectId]: { ...entry, isStale: true },
            },
          };
    });
  }

  function forgetRequestId(input: {
    projectId: string;
    requestId: string;
    isStale: boolean;
  }) {
    stores.projects.setState((state) => {
      const entry = state.opened[input.projectId];
      return {
        ownRequestIds: {
          ...state.ownRequestIds,
          [input.projectId]: (
            state.ownRequestIds[input.projectId] ?? []
          ).filter((requestId) => requestId !== input.requestId),
        },
        opened:
          entry === undefined || !input.isStale
            ? state.opened
            : {
                ...state.opened,
                [input.projectId]: { ...entry, isStale: true },
              },
      };
    });
  }

  function openIfNeeded(projectId: string) {
    const state = stores.projects.getState();
    const entry = state.opened[projectId];
    if (
      watched[projectId] === undefined ||
      opening[projectId] ||
      Object.hasOwn(state.openErrors, projectId) ||
      stores.snapshot.getState().connection !== "open" ||
      (entry !== undefined && !entry.isStale)
    )
      return;
    opening[projectId] = true;
    client
      .command({ type: "project.open", projectId })
      .then((ack) => {
        delete opening[projectId];
        const parsed = ack.ok ? ProjectSchema.safeParse(ack.result) : undefined;
        if (!ack.ok || parsed?.success !== true) {
          const error = ack.ok
            ? "The daemon sent a project this app cannot read"
            : ack.error;
          stores.projects.setState((current) => ({
            openErrors: { ...current.openErrors, [projectId]: error },
          }));
          return;
        }
        const project = parsed.data;
        stores.projects.setState((current) => ({
          opened: {
            ...current.opened,
            [projectId]: { project, isStale: false },
          },
        }));
      })
      .catch(() => {
        delete opening[projectId];
      })
      .finally(() => openIfNeeded(projectId));
  }

  function openWatched() {
    for (const projectId of Object.keys(watched)) openIfNeeded(projectId);
  }

  let unsubscribes: (() => void)[] = [];

  return {
    stores,
    undoDiff: createDiffUndo({
      connected: () => stores.snapshot.getState().connection === "open",
      activity: stores.activity,
      command: client.command,
      itemExists(input) {
        const state = stores.projects.getState();
        const entry = state.opened[input.projectId];
        if (
          !entry ||
          entry.isStale ||
          (state.ownRequestIds[input.projectId]?.length ?? 0) > 0
        )
          return undefined;
        return entry.project.scene.items.some(
          (item) => item.id === input.itemId,
        );
      },
    }),
    watchChat: chatSync.watch,
    retryChat: chatSync.retry,
    command: client.command,
    start() {
      if (unsubscribes.length === 0)
        unsubscribes = [
          stores.snapshot.subscribe(openWatched),
          stores.projects.subscribe(openWatched),
        ];
      chatSync.start();
      client.start();
    },
    stop() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      chatSync.stop();
      client.stop();
    },
    /** Keep `projectId` open, reopening it whenever it goes stale, until the returned function is called; a new watch forgets an earlier failed open. */
    watchProject(projectId: string) {
      watched[projectId] = (watched[projectId] ?? 0) + 1;
      stores.projects.setState((state) => ({
        openErrors: Object.fromEntries(
          Object.entries(state.openErrors).filter(([id]) => id !== projectId),
        ),
      }));
      openIfNeeded(projectId);
      return () => {
        const count = (watched[projectId] ?? 1) - 1;
        if (count > 0) watched[projectId] = count;
        else delete watched[projectId];
      };
    },
    /** Apply `command` to the open project at once and send it; return `false` without sending when the project is not open or the reducer rejects it. */
    applySceneCommand(input: { projectId: string; command: Command }) {
      const entry = stores.projects.getState().opened[input.projectId];
      if (entry === undefined || entry.isStale) return false;
      const result = applyCommand({
        scene: entry.project.scene,
        command: input.command,
      });
      if (result.kind === "rejected") return false;
      const requestId = crypto.randomUUID();
      stores.projects.setState((state) => ({
        opened: {
          ...state.opened,
          [input.projectId]: {
            ...entry,
            project: { ...entry.project, scene: result.scene },
          },
        },
        ownRequestIds: {
          ...state.ownRequestIds,
          [input.projectId]: [
            ...(state.ownRequestIds[input.projectId] ?? []),
            requestId,
          ],
        },
      }));
      client
        .command({
          type: "scene.apply",
          requestId,
          projectId: input.projectId,
          command: input.command,
        })
        .then((ack) => {
          if (ack.ok) return;
          forgetRequestId({
            projectId: input.projectId,
            requestId,
            isStale: false,
          });
          markStale(input.projectId);
        })
        .catch(() =>
          forgetRequestId({
            projectId: input.projectId,
            requestId,
            isStale: true,
          }),
        );
      return true;
    },
  };
}
