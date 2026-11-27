import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useStore } from "zustand";
import { usePlannerSession } from "../../planner/use-planner-session.ts";
import type { GenerationAction } from "./generation-action.ts";
import { getGenerationAlternatives } from "./get-generation-alternatives.ts";
import { getGenerationRequest } from "./get-generation-request.ts";
import { sendGenerationCommand } from "./send-generation-command.ts";

type UseGenerationActionsOptions = {
  projectId: string;
  item: Item;
  onSendDesignerRequest: (text: string) => Promise<boolean>;
  onUpdate: (patch: ItemPatch) => boolean;
};

export function useGenerationActions(options: UseGenerationActionsOptions) {
  const session = usePlannerSession();
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const chat = useStore(
    session.stores.activity,
    (state) => state.chats[options.projectId],
  );
  const alternatives = getGenerationAlternatives({
    projectId: options.projectId,
    itemId: options.item.id,
    jobs: Object.values(jobs),
    messages: chat?.messages ?? [],
  });
  async function request(action: GenerationAction) {
    switch (action.kind) {
      case "start":
      case "retry":
        return sendGenerationCommand({
          command: session.command,
          request: {
            type: "generation.start",
            projectId: options.projectId,
            itemId: options.item.id,
          },
        });
      case "alternatives":
        return sendGenerationCommand({
          command: session.command,
          request: {
            type: "generation.alternatives",
            projectId: options.projectId,
            itemId: options.item.id,
          },
        });
      case "keep": {
        const asset = alternatives.assets.find(
          (asset) => asset.assetId === action.assetId,
        );
        if (!asset) throw new Error("This version is no longer available");
        if (
          !options.onUpdate({
            model: { kind: "asset", assetId: asset.assetId },
            ...(options.item.cutsOpening ? {} : { sizeM: asset.sizeM }),
          })
        )
          throw new Error("Could not keep this version");
        return;
      }
      case "regenerate":
        return sendGenerationCommand({
          command: session.command,
          request: {
            type: "generation.regenerate",
            projectId: options.projectId,
            itemId: options.item.id,
            notes: action.notes,
          },
        });
      case "color-variant":
      case "shape-variant":
        if (
          !(await options.onSendDesignerRequest(
            getGenerationRequest({ item: options.item, action }),
          ))
        )
          throw new Error("Could not send the request to the designer");
        return;
      default: {
        const unreachable: never = action;
        return unreachable;
      }
    }
  }
  return { jobs, alternatives, request };
}
