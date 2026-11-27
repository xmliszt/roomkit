import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type {
  createActivityStore,
  DiffUndoState,
} from "../activity/create-activity-store.ts";
import type { createWsClient } from "../ws/ws-client.ts";

export function createDiffUndo(options: {
  activity: ReturnType<typeof createActivityStore>;
  connected: () => boolean;
  itemExists?: (input: {
    projectId: string;
    itemId: string;
  }) => boolean | undefined;
  command: ReturnType<typeof createWsClient>["command"];
}) {
  return async function undo(input: {
    projectId: string;
    blockKey: string;
    commands: Command[];
  }) {
    const previous = options.activity.getState().undos[input.blockKey];
    if (previous && previous.kind !== "failed") return;
    let completed = previous?.completed ?? 0;
    function update(state: DiffUndoState) {
      options.activity.setState((current) => ({
        undos: { ...current.undos, [input.blockKey]: state },
      }));
    }
    update({ kind: "running", completed });
    try {
      for (const command of input.commands.slice(completed)) {
        if (!options.connected()) {
          update({
            kind: "failed",
            completed,
          });
          return;
        }
        if (
          command.type === "item.remove" &&
          options.itemExists?.({
            projectId: input.projectId,
            itemId: command.itemId,
          }) === false
        ) {
          completed += 1;
          update({ kind: "running", completed });
          continue;
        }
        const ack = await options.command({
          type: "scene.apply",
          projectId: input.projectId,
          command,
        });
        if (!ack.ok) {
          update({ kind: "failed", completed, error: ack.error });
          return;
        }
        completed += 1;
        update({ kind: "running", completed });
      }
      update({ kind: "done", completed });
    } catch {
      update({
        kind: "unknown",
        completed,
      });
    }
  };
}
