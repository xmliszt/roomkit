import type { Placement } from "../scene/placement-schema.ts";
import type { Scene } from "../scene/scene-schema.ts";
import type { Command, ItemPatch } from "./command-schema.ts";

/** Return the command that restores `scene` after `command` has been applied to it, or `undefined` when `command` is an `item.update` or `item.remove` whose `itemId` is not in `scene.items`. */
export function invertCommand(options: {
  scene: Scene;
  command: Command;
}): Command | undefined {
  const { scene, command } = options;
  switch (command.type) {
    case "item.add":
      return { type: "item.remove", itemId: command.item.id };
    case "item.duplicate":
      return { type: "item.remove", itemId: command.newItemId };
    case "item.remove": {
      const index = scene.items.findIndex((item) => item.id === command.itemId);
      const item = scene.items.at(index);
      if (index < 0 || item === undefined) return undefined;
      return { type: "item.add", item, index };
    }
    case "item.update": {
      const item = scene.items.find(
        (candidate) => candidate.id === command.itemId,
      );
      if (item === undefined) return undefined;
      const patch: ItemPatch = {
        ...(command.patch.name === undefined ? {} : { name: item.name }),
        ...(command.patch.model === undefined ? {} : { model: item.model }),
        ...(command.patch.placement === undefined
          ? {}
          : { placement: item.placement }),
        ...(command.patch.sizeM === undefined ? {} : { sizeM: item.sizeM }),
        ...(command.patch.colorAdjust === undefined
          ? {}
          : { colorAdjust: item.colorAdjust ?? null }),
        ...(command.patch.mirrored === undefined
          ? {}
          : { mirrored: item.mirrored ?? null }),
        ...(command.patch.cutsOpening === undefined
          ? {}
          : { cutsOpening: item.cutsOpening ?? null }),
        ...(command.patch.light === undefined
          ? {}
          : { light: item.light ?? null }),
        ...(command.patch.locked === undefined ? {} : { locked: item.locked }),
      };
      return { type: "item.update", itemId: item.id, patch };
    }
    case "room.update": {
      const changedItemIds = Object.keys(command.placements ?? {});
      const placements: { [itemId: string]: Placement } = Object.fromEntries(
        scene.items
          .filter(
            (item) =>
              item.placement.kind === "floor" ||
              changedItemIds.includes(item.id),
          )
          .map((item) => [item.id, item.placement]),
      );
      return {
        type: "room.update",
        walls: scene.room.walls,
        ceilingHeightM: scene.room.ceilingHeightM,
        placements,
      };
    }
    case "surface.update":
      return {
        type: "surface.update",
        surfaceId: command.surfaceId,
        material: Object.hasOwn(scene.room.surfaces, command.surfaceId)
          ? (scene.room.surfaces[command.surfaceId]?.material ?? null)
          : null,
        color: Object.hasOwn(scene.room.surfaces, command.surfaceId)
          ? (scene.room.surfaces[command.surfaceId]?.color ?? null)
          : null,
      };
    case "camera.set":
      return { type: "camera.set", camera: scene.camera };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
