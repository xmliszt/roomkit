import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";
import { getAssetUrl } from "../items/get-asset-url.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";
import type { ChatActions } from "./chat-actions.ts";

export async function placeAsset(options: {
  block: Extract<ChatBlock, { kind: "asset" }>;
  actions: ChatActions;
  t: MessageTranslator;
}) {
  const response = await fetch(
    getAssetUrl({
      projectId: options.actions.projectId,
      assetId: options.block.assetId,
      fileName: "meta.json",
    }),
  );
  if (!response.ok)
    throw new Error(options.t("chat.asset-block.model-load-failed"));
  const meta = AssetMetaSchema.parse(await response.json());
  const placement: Placement = (() => {
    switch (meta.mount) {
      case "floor":
        return {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        };
      case "ceiling":
        return { kind: "ceiling", xM: 0, zM: 0, rotationRad: 0 };
      case "wall": {
        const wall = getWallSegments(options.actions.scene.room).find(
          (segment) => segment.wall.kind !== "open",
        );
        if (!wall)
          throw new Error(
            options.t(
              "editor.editor-shell.this-room-has-no-wall-for-the-model",
            ),
          );
        return {
          kind: "wall",
          wallId: wall.wall.id,
          alongM: wall.lengthM / 2,
          heightM: options.block.sizeM.height / 2,
          rotationRad: 0,
        };
      }
      default: {
        const unreachable: never = meta.mount;
        return unreachable;
      }
    }
  })();
  const id = crypto.randomUUID();
  if (
    !options.actions.onApply({
      type: "item.add",
      item: {
        id,
        name: options.block.name,
        model: { kind: "asset", assetId: options.block.assetId },
        sizeM: options.block.sizeM,
        placement,
        locked: false,
      },
    })
  )
    throw new Error(options.t("chat.asset-block.model-place-failed"));

  return id;
}
