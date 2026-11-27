import { describe, expect, it } from "vitest";
import { SurfaceMaterialSchema } from "../scene/surface-material-schema.ts";
import { applyCommand } from "./apply-command.ts";
import { buildTestScene } from "./build-test-scene.ts";
import { type Command, CommandSchema } from "./command-schema.ts";
import { invertCommand } from "./invert-command.ts";

const materials = [
  { kind: "paint", color: "#9cae92", finish: "matte" },
  {
    kind: "tiles",
    tileSizeM: { u: 0.8, v: 0.8 },
    groutWidthM: 0.003,
    groutColor: "#999999",
    baseColor: "#ffffff",
    roughness: 0.2,
  },
  {
    kind: "planks",
    plankSizeM: { u: 0.2, v: 1.2 },
    baseColor: "#be9f78",
    roughness: 0.5,
    textureAssetId: "oak",
  },
  {
    kind: "texture",
    repeatSizeM: { u: 0.5, v: 0.6 },
    roughness: 0.8,
    textureAssetId: "wallpaper",
  },
];

describe("surface materials", () => {
  it.each(materials)(
    "round trips $kind through undo for flat and missing surfaces",
    (value) => {
      for (const surfaceId of ["floor", "ceiling"]) {
        const scene = buildTestScene();
        const command = CommandSchema.parse({
          type: "surface.update",
          surfaceId,
          color: "#ffffff",
          material: value,
        });
        const result = applyCommand({ scene, command });
        expect(result.kind).toBe("applied");
        const undo = CommandSchema.parse(
          JSON.parse(JSON.stringify(invertCommand({ scene, command }))),
        );
        if (result.kind !== "applied") throw new Error(result.reason);
        expect(applyCommand({ scene: result.scene, command: undo })).toEqual({
          kind: "applied",
          scene,
        });
        expect(scene.room.surfaces.floor?.material).toBeUndefined();
        const materialScene = result.scene;
        for (const change of [
          { type: "surface.update", surfaceId, color: "#123456" },
          {
            type: "surface.update",
            surfaceId,
            color: "#123456",
            material: null,
          },
          { type: "surface.update", surfaceId, color: null },
        ] satisfies Command[]) {
          const changed = applyCommand({
            scene: materialScene,
            command: change,
          });
          if (changed.kind !== "applied") throw new Error(changed.reason);
          const inverse = CommandSchema.parse(
            JSON.parse(
              JSON.stringify(
                invertCommand({ scene: materialScene, command: change }),
              ),
            ),
          );
          expect(
            applyCommand({ scene: changed.scene, command: inverse }),
          ).toEqual({ kind: "applied", scene: materialScene });
          if (change.color !== null && !("material" in change))
            expect(changed.scene.room.surfaces[surfaceId]?.material).toEqual(
              value,
            );
        }
      }
    },
  );
  it("rejects invalid repeats, texture ids and unknown fields", () => {
    const texture = materials.at(3);
    for (const repeatSizeM of [
      { u: 0.049, v: 1 },
      { u: 1, v: 3.01 },
      { u: Number.NaN, v: 1 },
    ])
      expect(
        SurfaceMaterialSchema.safeParse({ ...texture, repeatSizeM }).success,
      ).toBe(false);
    for (const patch of [
      { textureAssetId: "../bad" },
      { textureAssetId: undefined },
      { roughness: 1.1 },
      { unknown: true },
    ])
      expect(
        SurfaceMaterialSchema.safeParse({ ...texture, ...patch }).success,
      ).toBe(false);
  });
  it("rejects material on a removed or nonexistent surface", () => {
    const scene = buildTestScene();
    for (const command of [
      {
        type: "surface.update",
        surfaceId: "floor",
        color: null,
        material: materials.at(0),
      },
      {
        type: "surface.update",
        surfaceId: "unknown",
        color: "#ffffff",
        material: materials.at(0),
      },
    ])
      expect(
        applyCommand({ scene, command: CommandSchema.parse(command) }).kind,
      ).toBe("rejected");
  });
});

it("rejects grout as wide as either tile dimension through direct commands", () => {
  const material = {
    kind: "tiles",
    tileSizeM: { u: 0.05, v: 0.8 },
    groutWidthM: 0.05,
    groutColor: "#999999",
    baseColor: "#ffffff",
    roughness: 0.2,
  } satisfies NonNullable<
    Extract<Command, { type: "surface.update" }>["material"]
  >;
  const command = {
    type: "surface.update",
    surfaceId: "floor",
    color: "#ffffff",
    material,
  } satisfies Command;
  expect(CommandSchema.safeParse(command).success).toBe(false);
  expect(applyCommand({ scene: buildTestScene(), command }).kind).toBe(
    "rejected",
  );
});
