import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import { useRef } from "react";
import type { createPlannerSession } from "../ws/create-planner-session.ts";

type Entry = { forward: Command[]; inverse: Command[] };

type Stacks = { projectId: string; undo: Entry[]; redo: Entry[] };

/** Return `apply`, `applyGroup`, `undo` and `redo` for one project, recording commands or command groups as undo steps and preserving the stacks while the project is stale. */
export function useSceneHistory(options: {
  session: ReturnType<typeof createPlannerSession>;
  projectId: string;
}) {
  const stacksRef = useRef<Stacks>({
    projectId: options.projectId,
    undo: [],
    redo: [],
  });

  function getStacks() {
    if (stacksRef.current.projectId !== options.projectId) {
      stacksRef.current = { projectId: options.projectId, undo: [], redo: [] };
    }
    return stacksRef.current;
  }

  function isStale() {
    return (
      options.session.stores.projects.getState().opened[options.projectId]
        ?.isStale ?? true
    );
  }

  function send(command: Command) {
    return options.session.applySceneCommand({
      projectId: options.projectId,
      command,
    });
  }

  function setStacks(stacks: Pick<Stacks, "undo" | "redo">) {
    stacksRef.current = { projectId: options.projectId, ...stacks };
  }

  return {
    apply(command: Command) {
      const stacks = getStacks();
      const scene =
        options.session.stores.projects.getState().opened[options.projectId]
          ?.project.scene;
      if (scene === undefined) return false;
      const inverse = invertCommand({ scene, command });
      if (inverse === undefined || !send(command)) return false;
      setStacks({
        undo: [...stacks.undo, { forward: [command], inverse: [inverse] }],
        redo: [],
      });
      return true;
    },
    applyGroup(commands: Command[]) {
      const stacks = getStacks();
      const scene =
        options.session.stores.projects.getState().opened[options.projectId]
          ?.project.scene;
      if (!scene || isStale() || commands.length === 0) return false;
      const prepared = commands.reduce<
        { scene: typeof scene; inverse: Command[] } | undefined
      >(
        (state, command) => {
          if (!state) return undefined;
          const inverse = invertCommand({ scene: state.scene, command });
          const result = applyCommand({ scene: state.scene, command });
          return inverse && result.kind === "applied"
            ? { scene: result.scene, inverse: [inverse, ...state.inverse] }
            : undefined;
        },
        { scene, inverse: [] },
      );
      if (!prepared) return false;
      if (!commands.every(send)) {
        setStacks({ undo: [], redo: [] });
        return false;
      }
      setStacks({
        undo: [
          ...stacks.undo,
          { forward: commands, inverse: prepared.inverse },
        ],
        redo: [],
      });
      return true;
    },
    undo() {
      const stacks = getStacks();
      const entry = stacks.undo.at(-1);
      if (entry === undefined || isStale()) return;
      if (!entry.inverse.every(send)) {
        setStacks({ undo: [], redo: [] });
        return;
      }
      setStacks({
        undo: stacks.undo.slice(0, -1),
        redo: [...stacks.redo, entry],
      });
    },
    redo() {
      const stacks = getStacks();
      const entry = stacks.redo.at(-1);
      if (entry === undefined || isStale()) return;
      if (!entry.forward.every(send)) {
        setStacks({ undo: [], redo: [] });
        return;
      }
      setStacks({
        undo: [...stacks.undo, entry],
        redo: stacks.redo.slice(0, -1),
      });
    },
  };
}
