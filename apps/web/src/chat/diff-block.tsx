"use client";

import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { useStore } from "zustand";
import { renderMessageParts } from "../i18n/render-message-parts.tsx";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { formatSceneChange } from "./format-scene-change.ts";

type DiffBlockProps = {
  block: Extract<ChatBlock, { kind: "diff" }>;
  projectId: string;
  blockKey: string;
};

export function DiffBlock(props: DiffBlockProps) {
  const t = useMessages();
  const locale = useLocale();
  const session = usePlannerSession();
  const connected = useStore(
    session.stores.snapshot,
    (state) => state.connection === "open",
  );
  const state = useStore(
    session.stores.activity,
    (current) => current.undos[props.blockKey],
  );
  const isDone = state?.kind === "done" || props.block.undo.length === 0;
  const isBusy = state?.kind === "running";
  const error =
    state?.kind === "failed"
      ? (state.error ?? t("chat.diff-block.reconnect-to-undo"))
      : state?.kind === "unknown"
        ? t("chat.diff-block.undo-unknown")
        : undefined;
  function undo() {
    void session.undoDiff({
      projectId: props.projectId,
      blockKey: props.blockKey,
      commands: props.block.undo,
    });
  }
  return (
    <div className="flex flex-col gap-y-2 border border-line p-2">
      {props.block.changes.map((change, index) => {
        const display = formatSceneChange({ change, locale, t });
        return (
          <div
            key={`${index}:${change.label}`}
            className="aligned-row diff-row"
          >
            <span className="text-ink-dim" dir="auto">
              {display.label}
            </span>
            <span>
              {renderMessageParts({
                message: t("chat.diff-block.previous-to-current"),
                parts: {
                  before: <bdi>{display.before}</bdi>,
                  after: <bdi>{display.after}</bdi>,
                },
              })}
            </span>
          </div>
        );
      })}
      <button
        type="button"
        disabled={!connected || isDone || isBusy || state?.kind === "unknown"}
        onClick={undo}
        className="self-end underline underline-offset-2 disabled:text-ink-dim"
      >
        {isDone
          ? t("chat.diff-block.undone")
          : isBusy
            ? t("chat.diff-block.undoing")
            : t("chat.diff-block.undo")}
      </button>
      {error && (
        <p role="alert" className="text-danger" dir="auto">
          {error}
        </p>
      )}
    </div>
  );
}
