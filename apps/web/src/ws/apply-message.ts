import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { ServerMessage } from "@planner/shared/src/protocol/server-message-schema.ts";
import type { createJobsStore } from "../stores/create-jobs-store.ts";
import type { createProjectsStore } from "../stores/create-projects-store.ts";
import type { createSnapshotStore } from "../stores/create-snapshot-store.ts";

type Stores = {
  snapshot: ReturnType<typeof createSnapshotStore>;
  projects: ReturnType<typeof createProjectsStore>;
  jobs: ReturnType<typeof createJobsStore>;
};

export function applyMessage(options: {
  stores: Stores;
  message: ServerMessage;
}) {
  const { stores, message } = options;
  switch (message.type) {
    case "snapshot":
      stores.snapshot.setState({ config: message.config, at: message.at });
      stores.projects.setState((state) => ({
        summaries: message.projects,
        opened: Object.fromEntries(
          Object.entries(state.opened).map(([projectId, entry]) => [
            projectId,
            { ...entry, isStale: true },
          ]),
        ),
        ownRequestIds: {},
      }));
      stores.jobs.setState({
        jobs: Object.fromEntries(message.jobs.map((job) => [job.id, job])),
      });
      return;
    case "language.changed":
      stores.snapshot.setState({
        languagePreference: { kind: "selected", locale: message.locale },
      });
      return;
    case "command.ack":
    case "auth.ok":
    case "auth.error":
      return;
    case "event": {
      const event = message.event;
      switch (event.kind) {
        case "project.created":
          stores.projects.setState((state) => ({
            summaries: [
              ...state.summaries.filter(
                (project) => project.id !== event.project.id,
              ),
              event.project,
            ].toSorted((a, b) => a.name.localeCompare(b.name)),
          }));
          return;
        case "project.renamed":
          stores.projects.setState((state) => {
            const entry = state.opened[event.project.id];
            return {
              summaries: state.summaries
                .map((project) =>
                  project.id === event.project.id ? event.project : project,
                )
                .toSorted((a, b) => a.name.localeCompare(b.name)),
              opened:
                entry === undefined
                  ? state.opened
                  : {
                      ...state.opened,
                      [event.project.id]: {
                        ...entry,
                        project: { ...entry.project, name: event.project.name },
                      },
                    },
            };
          });
          return;
        case "project.removed":
          stores.projects.setState((state) => ({
            summaries: state.summaries.filter(
              (project) => project.id !== event.projectId,
            ),
            opened: Object.fromEntries(
              Object.entries(state.opened).filter(
                ([projectId]) => projectId !== event.projectId,
              ),
            ),
            ownRequestIds: Object.fromEntries(
              Object.entries(state.ownRequestIds).filter(
                ([projectId]) => projectId !== event.projectId,
              ),
            ),
          }));
          return;
        case "scene.changed":
          stores.projects.setState((state) => {
            const entry = state.opened[event.projectId];
            const pendingIds = state.ownRequestIds[event.projectId] ?? [];
            const isOwn =
              event.requestId !== undefined &&
              pendingIds.includes(event.requestId);
            const ownRequestIds = {
              ...state.ownRequestIds,
              [event.projectId]: pendingIds.filter(
                (requestId) => requestId !== event.requestId,
              ),
            };
            if (
              entry === undefined ||
              entry.isStale ||
              event.revision <= entry.project.revision
            )
              return isOwn ? { ownRequestIds } : state;
            const result =
              event.revision !== entry.project.revision + 1 ||
              (!isOwn && pendingIds.length > 0)
                ? undefined
                : isOwn
                  ? entry.project.scene
                  : (() => {
                      const applied = applyCommand({
                        scene: entry.project.scene,
                        command: event.command,
                      });
                      return applied.kind === "applied"
                        ? applied.scene
                        : undefined;
                    })();
            return {
              ownRequestIds,
              opened: {
                ...state.opened,
                [event.projectId]:
                  result === undefined
                    ? { ...entry, isStale: true }
                    : {
                        isStale: false,
                        project: {
                          ...entry.project,
                          revision: event.revision,
                          scene: result,
                        },
                      },
              },
            };
          });
          return;
        case "chat.message.added":
        case "chat.text.appended":
        case "chat.block.set":
        case "chat.message.finished":
        case "job.log":
        case "preflight.updated":
          return;
        case "job.updated":
          stores.jobs.setState((state) => ({
            jobs: { ...state.jobs, [event.job.id]: event.job },
          }));
          return;
        default: {
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
