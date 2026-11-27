import { describe, expect, test } from "vitest";
import { ItemSchema } from "../scene/item-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import { applyCommand } from "./apply-command.ts";
import { buildTestScene } from "./build-test-scene.ts";
import { CommandSchema } from "./command-schema.ts";
import { invertCommand } from "./invert-command.ts";

function buildOpeningScene(options: { cutsOpening: boolean | undefined }) {
  const scene = buildTestScene();
  return SceneSchema.parse({
    ...scene,
    items: scene.items
      .filter((item) => item.placement.kind === "wall")
      .map((item) => ({
        ...item,
        ...(options.cutsOpening === undefined
          ? {}
          : { cutsOpening: options.cutsOpening }),
      })),
  });
}

for (const before of [undefined, false, true]) {
  describe(`cutsOpening initially ${String(before)}`, () => {
    for (const after of [null, false, true]) {
      test(`setting ${String(after)} preserves placement and size and undoes exactly after serialization`, () => {
        const scene = buildOpeningScene({ cutsOpening: before });
        const original = structuredClone(scene);
        const item = scene.items.at(0);
        if (item === undefined) throw new Error("Missing test item");
        const command = CommandSchema.parse({
          type: "item.update",
          itemId: item.id,
          patch: { cutsOpening: after },
        });
        const inverse = invertCommand({ scene, command });
        if (inverse === undefined) throw new Error("Missing inverse");
        const result = applyCommand({ scene, command });
        if (result.kind === "rejected") throw new Error(result.reason);
        const { cutsOpening: _previous, ...unchanged } = item;
        expect(result.scene.items.at(0)).toStrictEqual({
          ...unchanged,
          ...(after === null ? {} : { cutsOpening: after }),
        });
        const restored = applyCommand({
          scene: result.scene,
          command: CommandSchema.parse(JSON.parse(JSON.stringify(inverse))),
        });
        expect(restored).toStrictEqual({ kind: "applied", scene });
        expect(scene).toStrictEqual(original);
      });
    }

    test("duplicate copies the opening flag", () => {
      const scene = buildOpeningScene({ cutsOpening: before });
      const item = scene.items.at(0);
      if (!item) throw new Error("Missing test item");
      const command = CommandSchema.parse({
        type: "item.duplicate",
        itemId: item.id,
        newItemId: "copy",
        placement: item.placement,
      });
      const result = applyCommand({ scene, command });
      if (result.kind === "rejected") throw new Error(result.reason);
      expect(result.scene.items.at(-1)).toStrictEqual({ ...item, id: "copy" });
    });
  });
}

test("only booleans are stored and only update patches can clear openings", () => {
  const item = buildTestScene().items.at(0);
  if (item === undefined) throw new Error("Missing test item");
  for (const cutsOpening of [null, 0, 1, "true"]) {
    expect(
      ItemSchema.safeParse({
        ...item,
        cutsOpening,
      }).success,
    ).toBe(false);
    expect(
      CommandSchema.safeParse({
        type: "item.duplicate",
        itemId: item.id,
        newItemId: "copy",
        placement: item.placement,
        cutsOpening,
      }).success,
    ).toBe(false);
    if (cutsOpening !== null)
      expect(
        CommandSchema.safeParse({
          type: "item.update",
          itemId: item.id,
          patch: { cutsOpening },
        }).success,
      ).toBe(false);
  }
});

for (const cutsOpening of [false, true]) {
  test(`floor and ceiling items cannot set cutsOpening ${cutsOpening}`, () => {
    const scene = buildTestScene();
    for (const item of scene.items.filter(
      (item) => item.placement.kind !== "wall",
    )) {
      expect(
        applyCommand({
          scene,
          command: {
            type: "item.update",
            itemId: item.id,
            patch: { cutsOpening },
          },
        }).kind,
      ).toBe("rejected");
      expect(
        applyCommand({
          scene,
          command: {
            type: "item.add",
            item: { ...item, id: "added", cutsOpening },
          },
        }).kind,
      ).toBe("rejected");
    }
  });
}

test("moving an opening off a wall requires removing the flag in the same patch", () => {
  const scene = buildOpeningScene({ cutsOpening: true });
  const item = scene.items.at(0);
  if (!item) throw new Error("Missing wall item");
  const placement = {
    kind: "floor",
    xM: 0,
    zM: 0,
    elevationM: 0,
    rotationRad: 0,
  } satisfies typeof item.placement;
  expect(
    applyCommand({
      scene,
      command: { type: "item.update", itemId: item.id, patch: { placement } },
    }).kind,
  ).toBe("rejected");
  expect(
    applyCommand({
      scene,
      command: {
        type: "item.update",
        itemId: item.id,
        patch: { placement, cutsOpening: null },
      },
    }).kind,
  ).toBe("applied");
});

for (const cutsOpening of [undefined, false, true]) {
  test(`unrelated edits and JSON round-trip preserve cutsOpening ${String(cutsOpening)}`, () => {
    const scene = buildOpeningScene({ cutsOpening });
    const item = scene.items.at(0);
    if (!item) throw new Error("Missing wall item");
    const result = applyCommand({
      scene,
      command: {
        type: "item.update",
        itemId: item.id,
        patch: { name: "Door" },
      },
    });
    if (result.kind === "rejected") throw new Error(result.reason);
    const parsed = SceneSchema.parse(JSON.parse(JSON.stringify(result.scene)));
    expect(parsed.items.at(0)).toStrictEqual({ ...item, name: "Door" });
    expect(Object.hasOwn(parsed.items.at(0) ?? {}, "cutsOpening")).toBe(
      cutsOpening !== undefined,
    );
  });
}
