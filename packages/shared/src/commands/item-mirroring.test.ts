import { describe, expect, test } from "vitest";
import { ItemSchema } from "../scene/item-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import { applyCommand } from "./apply-command.ts";
import { buildTestScene } from "./build-test-scene.ts";
import { CommandSchema } from "./command-schema.ts";
import { invertCommand } from "./invert-command.ts";

function buildMirroredScene(options: { mirrored: boolean | undefined }) {
  const scene = buildTestScene();
  return SceneSchema.parse({
    ...scene,
    items: scene.items.map((item) => ({
      ...item,
      ...(options.mirrored === undefined ? {} : { mirrored: options.mirrored }),
    })),
  });
}

for (const before of [undefined, false, true]) {
  describe(`mirrored initially ${String(before)}`, () => {
    for (const after of [null, false, true]) {
      test(`setting ${String(after)} preserves placement and size and undoes exactly after serialization`, () => {
        const scene = buildMirroredScene({ mirrored: before });
        const original = structuredClone(scene);
        const item = scene.items.at(0);
        if (item === undefined) throw new Error("Missing test item");
        const command = CommandSchema.parse({
          type: "item.update",
          itemId: item.id,
          patch: { mirrored: after },
        });
        const inverse = invertCommand({ scene, command });
        if (inverse === undefined) throw new Error("Missing inverse");
        const result = applyCommand({ scene, command });
        if (result.kind === "rejected") throw new Error(result.reason);
        const { mirrored: _previous, ...unchanged } = item;
        expect(result.scene.items.at(0)).toStrictEqual({
          ...unchanged,
          ...(after === null ? {} : { mirrored: after }),
        });
        const restored = applyCommand({
          scene: result.scene,
          command: CommandSchema.parse(JSON.parse(JSON.stringify(inverse))),
        });
        expect(restored).toStrictEqual({ kind: "applied", scene });
        expect(scene).toStrictEqual(original);
      });
    }

    for (const override of [undefined, false, true]) {
      test(`duplicate with mirrored ${String(override)} preserves the source and undo removes only the copy`, () => {
        const scene = buildMirroredScene({ mirrored: before });
        const item = scene.items.at(0);
        if (item === undefined) throw new Error("Missing test item");
        const placement = { ...item.placement, rotationRad: 1 };
        const command = CommandSchema.parse({
          type: "item.duplicate",
          itemId: item.id,
          newItemId: "mirrored-copy",
          placement,
          ...(override === undefined ? {} : { mirrored: override }),
        });
        const result = applyCommand({ scene, command });
        if (result.kind === "rejected") throw new Error(result.reason);
        expect(result.scene.items.slice(0, -1)).toStrictEqual(scene.items);
        expect(result.scene.items.at(-1)).toStrictEqual({
          ...item,
          id: "mirrored-copy",
          placement,
          ...(override === undefined ? {} : { mirrored: override }),
        });
        const inverse = invertCommand({ scene, command });
        if (inverse === undefined) throw new Error("Missing inverse");
        expect(
          applyCommand({ scene: result.scene, command: inverse }),
        ).toStrictEqual({
          kind: "applied",
          scene,
        });
      });
    }
  });
}

test("unrelated edits preserve mirroring and legacy items keep the field absent", () => {
  for (const mirrored of [undefined, false, true]) {
    const scene = buildMirroredScene({ mirrored });
    const item = scene.items.at(0);
    if (item === undefined) throw new Error("Missing test item");
    const result = applyCommand({
      scene,
      command: {
        type: "item.update",
        itemId: item.id,
        patch: { name: "New name" },
      },
    });
    if (result.kind === "rejected") throw new Error(result.reason);
    expect(result.scene.items.at(0)).toStrictEqual({
      ...scene.items.at(0),
      name: "New name",
    });
    expect(Object.hasOwn(result.scene.items.at(0) ?? {}, "mirrored")).toBe(
      mirrored !== undefined,
    );
  }
});

test("only booleans are stored and only update patches can clear mirroring", () => {
  const item = buildTestScene().items.at(0);
  if (item === undefined) throw new Error("Missing test item");
  for (const mirrored of [null, 0, 1, "true"]) {
    expect(
      ItemSchema.safeParse({
        ...item,
        mirrored,
      }).success,
    ).toBe(false);
    expect(
      CommandSchema.safeParse({
        type: "item.duplicate",
        itemId: item.id,
        newItemId: "copy",
        placement: item.placement,
        mirrored,
      }).success,
    ).toBe(false);
    if (mirrored !== null)
      expect(
        CommandSchema.safeParse({
          type: "item.update",
          itemId: item.id,
          patch: { mirrored },
        }).success,
      ).toBe(false);
  }
});
