import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import { buildItem } from "@planner/shared/src/commands/build-item.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { useSceneHistory } from "./use-scene-history.ts";

test("one undo restores every item and a rerender preserves the grouped redo", () => {
  const placement = {
    kind: "floor",
    xM: 0,
    zM: 0,
    elevationM: 0,
    rotationRad: 0,
  } satisfies Placement;
  const original: Scene = {
    ...createRectangularScene({ widthM: 6, depthM: 6, ceilingHeightM: 3 }),
    items: [
      buildItem({ id: "a", placement }),
      buildItem({
        id: "b",
        placement,
        colorAdjust: { kind: "colorize", color: "#ff0000", strength: 0.5 },
      }),
    ],
  };
  const commands: Command[] = original.items.map((item) => ({
    type: "item.update",
    itemId: item.id,
    patch: {
      colorAdjust: { kind: "colorize", color: "#0000ff", strength: 1 },
      locked: true,
      mirrored: true,
    },
  }));
  const session = createPlannerSession({
    url: "ws://unused",
    createSocket() {
      throw new Error("This test never connects");
    },
  });
  session.stores.projects.setState({
    opened: {
      project: {
        isStale: false,
        project: { id: "project", name: "Room", revision: 0, scene: original },
      },
    },
  });
  const options = {
    projectId: "project",
    session: {
      ...session,
      applySceneCommand(
        input: Parameters<typeof session.applySceneCommand>[0],
      ) {
        const entry = session.stores.projects.getState().opened.project;
        if (!entry) return false;
        const result = applyCommand({
          scene: entry.project.scene,
          command: input.command,
        });
        if (result.kind !== "applied") return false;
        session.stores.projects.setState({
          opened: {
            project: {
              ...entry,
              project: { ...entry.project, scene: result.scene },
            },
          },
        });
        return true;
      },
    },
  };
  const hook = renderHook(() => useSceneHistory(options));
  try {
    act(() => {
      expect(hook.result.current.applyGroup(commands)).toBe(true);
    });
    expect(
      session.stores.projects
        .getState()
        .opened.project?.project.scene.items.map((item) => item.colorAdjust),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        kind: "colorize",
        color: "#0000ff",
        strength: 1,
      })),
    );
    hook.rerender();
    act(() => hook.result.current.undo());
    expect(
      session.stores.projects.getState().opened.project?.project.scene,
    ).toEqual(original);
    hook.rerender();
    act(() => hook.result.current.redo());
    expect(
      session.stores.projects
        .getState()
        .opened.project?.project.scene.items.every(
          (item) => item.locked && item.mirrored,
        ),
    ).toBe(true);
  } finally {
    hook.unmount();
    session.stop();
  }
});
