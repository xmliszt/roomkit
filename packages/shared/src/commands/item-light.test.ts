import { describe, expect, test } from "vitest";
import type { Light } from "../scene/light-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import { applyCommand } from "./apply-command.ts";
import { buildTestScene } from "./build-test-scene.ts";
import { type Command, CommandSchema } from "./command-schema.ts";
import { invertCommand } from "./invert-command.ts";

const lampLight = {
  on: true,
  emitter: { x: 0.3, y: 0.85, z: 0.5 },
  beam: { direction: { x: 0.6, y: -0.8, z: 0 }, angleDeg: 90 },
  shade: "translucent",
  lumens: 400,
  temperatureK: 2700,
} satisfies Light;

function buildLightScene(options: { light: Light | undefined }) {
  const scene = buildTestScene();
  return SceneSchema.parse({
    ...scene,
    items: scene.items.map((item) => ({
      ...item,
      ...(options.light === undefined ? {} : { light: options.light }),
    })),
  });
}

function apply(options: {
  scene: ReturnType<typeof buildLightScene>;
  command: Command;
}) {
  const result = applyCommand(options);
  if (result.kind === "rejected") throw new Error(result.reason);
  return result.scene;
}

for (const before of [undefined, lampLight]) {
  describe(`light initially ${before === undefined ? "absent" : "on"}`, () => {
    for (const after of [null, { ...lampLight, on: false }, lampLight]) {
      test(`setting ${after === null ? "null" : `on=${after.on}`} changes only the light and undoes exactly after serialization`, () => {
        const scene = buildLightScene({ light: before });
        const original = structuredClone(scene);
        const item = scene.items.at(0);
        if (item === undefined) throw new Error("Missing test item");
        const command = CommandSchema.parse({
          type: "item.update",
          itemId: item.id,
          patch: { light: after },
        });
        const inverse = invertCommand({ scene, command });
        if (inverse === undefined) throw new Error("Missing inverse");
        const updated = apply({ scene, command });
        const { light: _previous, ...unchanged } = item;
        expect(updated.items.at(0)).toStrictEqual({
          ...unchanged,
          ...(after === null ? {} : { light: after }),
        });
        const restored = apply({
          scene: SceneSchema.parse(JSON.parse(JSON.stringify(updated))),
          command: CommandSchema.parse(JSON.parse(JSON.stringify(inverse))),
        });
        expect(restored).toStrictEqual(original);
      });
    }
  });
}

test("an update that leaves light out keeps it", () => {
  const scene = buildLightScene({ light: lampLight });
  const updated = apply({
    scene,
    command: { type: "item.update", itemId: "sofa", patch: { name: "Lamp" } },
  });
  expect(updated.items.at(0)?.light).toStrictEqual(lampLight);
});

for (const mirrored of [undefined, true]) {
  test(`duplicate${mirrored ? " mirrored" : ""} copies the light unchanged`, () => {
    const scene = buildLightScene({ light: lampLight });
    const source = scene.items.at(0);
    if (source === undefined) throw new Error("Missing test item");
    const updated = apply({
      scene,
      command: {
        type: "item.duplicate",
        itemId: source.id,
        newItemId: "copy",
        placement: source.placement,
        ...(mirrored === undefined ? {} : { mirrored }),
      },
    });
    expect(updated.items.at(-1)).toStrictEqual({
      ...source,
      id: "copy",
      ...(mirrored === undefined ? {} : { mirrored }),
    });
  });
}

test("mirroring a lamp keeps its stored light and undoes exactly", () => {
  const scene = buildLightScene({ light: lampLight });
  const command = CommandSchema.parse({
    type: "item.update",
    itemId: "sofa",
    patch: { mirrored: true },
  });
  const inverse = invertCommand({ scene, command });
  if (inverse === undefined) throw new Error("Missing inverse");
  const mirrored = apply({ scene, command });
  expect(mirrored.items.at(0)?.light).toStrictEqual(lampLight);
  expect(apply({ scene: mirrored, command: inverse })).toStrictEqual(scene);
});
