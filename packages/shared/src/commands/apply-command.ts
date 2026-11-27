import type { Item } from "../scene/item-schema.ts";
import type { Scene } from "../scene/scene-schema.ts";
import { SceneSchema } from "../scene/scene-schema.ts";
import type { Command } from "./command-schema.ts";
import { moveFloorItems } from "./move-floor-items.ts";

export type ApplyResult =
  | { kind: "applied"; scene: Scene }
  | { kind: "rejected"; reason: string };

function rejected(reason: string): ApplyResult {
  return { kind: "rejected", reason };
}

function checked(scene: Scene): ApplyResult {
  const issue = SceneSchema.safeParse(scene).error?.issues.at(0);
  return issue === undefined
    ? { kind: "applied", scene }
    : rejected(
        issue.code === "custom"
          ? issue.message
          : `${issue.path.join(".")}: ${issue.message}`,
      );
}

/** Return the scene that results from `command`, or the reason the command does not apply; `scene` is left unchanged, and the result depends only on the two inputs. */
export function applyCommand(options: {
  scene: Scene;
  command: Command;
}): ApplyResult {
  const { scene, command } = options;
  switch (command.type) {
    case "item.add": {
      const index = command.index ?? scene.items.length;
      if (index > scene.items.length)
        return rejected(`Index ${index} is past the end of the item list`);
      return checked({
        ...scene,
        items: scene.items.toSpliced(index, 0, command.item),
      });
    }
    case "item.update": {
      const item = scene.items.find(
        (candidate) => candidate.id === command.itemId,
      );
      if (item === undefined)
        return rejected(`Item ${command.itemId} does not exist`);
      const patch = command.patch;
      const colorAdjust =
        patch.colorAdjust === undefined
          ? item.colorAdjust
          : (patch.colorAdjust ?? undefined);
      const mirrored =
        patch.mirrored === undefined
          ? item.mirrored
          : (patch.mirrored ?? undefined);
      const cutsOpening =
        patch.cutsOpening === undefined
          ? item.cutsOpening
          : (patch.cutsOpening ?? undefined);
      const light =
        patch.light === undefined ? item.light : (patch.light ?? undefined);
      const updated: Item = {
        id: item.id,
        name: patch.name ?? item.name,
        model: patch.model ?? item.model,
        placement: patch.placement ?? item.placement,
        sizeM: patch.sizeM ?? item.sizeM,
        ...(colorAdjust === undefined ? {} : { colorAdjust }),
        ...(mirrored === undefined ? {} : { mirrored }),
        ...(cutsOpening === undefined ? {} : { cutsOpening }),
        ...(light === undefined ? {} : { light }),
        locked: patch.locked ?? item.locked,
      };
      return checked({
        ...scene,
        items: scene.items.map((candidate) =>
          candidate.id === item.id ? updated : candidate,
        ),
      });
    }
    case "item.duplicate": {
      const item = scene.items.find(
        (candidate) => candidate.id === command.itemId,
      );
      if (item === undefined)
        return rejected(`Item ${command.itemId} does not exist`);
      if (item.model.kind === "pending")
        return rejected(`Item ${item.id} is still generating`);
      return checked({
        ...scene,
        items: [
          ...scene.items,
          {
            ...item,
            id: command.newItemId,
            placement: command.placement,
            ...(command.mirrored === undefined
              ? {}
              : { mirrored: command.mirrored }),
          },
        ],
      });
    }
    case "item.remove": {
      if (!scene.items.some((item) => item.id === command.itemId))
        return rejected(`Item ${command.itemId} does not exist`);
      return checked({
        ...scene,
        items: scene.items.filter((item) => item.id !== command.itemId),
      });
    }
    case "room.update": {
      if (
        command.walls === undefined &&
        command.ceilingHeightM === undefined &&
        command.placements === undefined
      )
        return rejected("The command changes nothing");
      const placements = command.placements ?? {};
      const unknownItemId = Object.keys(placements).find(
        (itemId) => !scene.items.some((item) => item.id === itemId),
      );
      if (unknownItemId !== undefined)
        return rejected(`Item ${unknownItemId} does not exist`);
      const walls = command.walls ?? scene.room.walls;
      return checked({
        ...scene,
        room: {
          ...scene.room,
          walls,
          ceilingHeightM: command.ceilingHeightM ?? scene.room.ceilingHeightM,
        },
        items: moveFloorItems({
          items: scene.items,
          oldWalls: scene.room.walls,
          newWalls: walls,
          placements,
        }),
      });
    }
    case "surface.update": {
      if (
        command.color === null &&
        !Object.hasOwn(scene.room.surfaces, command.surfaceId)
      )
        return rejected(`Surface ${command.surfaceId} has no colour to remove`);
      if (command.color === null && command.material != null)
        return rejected("A removed surface cannot have a material");
      const previous = Object.hasOwn(scene.room.surfaces, command.surfaceId)
        ? scene.room.surfaces[command.surfaceId]
        : undefined;
      const material =
        command.material === undefined
          ? previous?.material
          : (command.material ?? undefined);
      const { [command.surfaceId]: _removed, ...others } = scene.room.surfaces;
      return checked({
        ...scene,
        room: {
          ...scene.room,
          surfaces:
            command.color === null
              ? others
              : {
                  ...others,
                  [command.surfaceId]: {
                    color: command.color,
                    ...(material === undefined ? {} : { material }),
                  },
                },
        },
      });
    }
    case "camera.set":
      return checked({ ...scene, camera: command.camera });
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
