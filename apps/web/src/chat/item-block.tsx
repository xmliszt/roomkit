import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { Box } from "lucide-react";
import Image from "next/image";
import { useEffect } from "react";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useMessages } from "../i18n/use-messages.ts";
import type { ChatActions } from "./chat-actions.ts";

type ItemBlockProps = {
  block: Extract<ChatBlock, { kind: "item" }>;
  actions: ChatActions;
};

export function ItemBlock(props: ItemBlockProps) {
  const t = useMessages();
  const onHover = props.actions.onHover;
  const exists = props.actions.scene.items.some(
    (item) => item.id === props.block.itemId,
  );
  useEffect(() => () => onHover(undefined), [onHover]);
  return (
    <button
      type="button"
      disabled={!exists}
      title={
        exists
          ? t("chat.item-block.select-name", { name: props.block.name })
          : t("chat.item-block.name-removed", { name: props.block.name })
      }
      onPointerEnter={() => onHover(props.block.itemId)}
      onPointerLeave={() => onHover(undefined)}
      onFocus={() => onHover(props.block.itemId)}
      onBlur={() => onHover(undefined)}
      onClick={() => props.actions.onSelect(props.block.itemId)}
      className="flex max-w-full items-center gap-x-1.5 rounded-panel border border-line px-2 py-1 text-left hover:border-line-strong disabled:text-ink-dim"
    >
      {props.block.assetId ? (
        <Image
          unoptimized
          width={24}
          height={24}
          alt=""
          crossOrigin="anonymous"
          className="size-6 object-contain"
          src={getDaemonUrl({
            path: `/projects/${encodeURIComponent(props.actions.projectId)}/assets/${encodeURIComponent(props.block.assetId)}/thumb.png`,
          })}
        />
      ) : (
        <Box aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.5} />
      )}
      <span className="truncate">
        <bdi>{props.block.name}</bdi>
        {exists ? "" : t("chat.item-block.removed")}
      </span>
    </button>
  );
}
