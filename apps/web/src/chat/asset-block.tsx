"use client";

import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { useState } from "react";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { AssetPreview } from "./asset-preview.tsx";
import type { ChatActions } from "./chat-actions.ts";
import { placeAsset } from "./place-asset.ts";

type AssetBlockProps = {
  block: Extract<ChatBlock, { kind: "asset" }>;
  actions: ChatActions;
};

export function AssetBlock(props: AssetBlockProps) {
  const t = useMessages();
  const locale = useLocale();
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const existing = props.actions.scene.items.find(
    (item) =>
      item.model.kind === "asset" && item.model.assetId === props.block.assetId,
  );
  async function place() {
    setIsBusy(true);
    setError(undefined);
    try {
      const id = await placeAsset({
        block: props.block,
        actions: props.actions,
        t,
      });
      props.actions.onFocus(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-y-2 border border-line p-2">
      <div className="flex items-center gap-x-3">
        <AssetPreview
          projectId={props.actions.projectId}
          assetId={props.block.assetId}
          sizeM={props.block.sizeM}
        />
        <div className="flex min-w-0 flex-col gap-y-2">
          <p dir="auto">{props.block.name}</p>
          <p className="text-ink-dim tabular-nums">
            {formatDecimal({ value: props.block.sizeM.width, locale })} ×{" "}
            {formatDecimal({ value: props.block.sizeM.height, locale })} ×{" "}
            {formatDecimal({ value: props.block.sizeM.depth, locale })} m
          </p>
          <div className="flex gap-x-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void place()}
              className="underline disabled:opacity-50"
            >
              {t("chat.asset-block.place")}
            </button>
            <button
              type="button"
              disabled={!existing}
              onClick={() => {
                if (existing) props.actions.onFocus(existing.id);
              }}
              className="underline disabled:opacity-50"
            >
              {t("chat.asset-block.focus")}
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger" dir="auto">
          {error}
        </p>
      )}
    </div>
  );
}
