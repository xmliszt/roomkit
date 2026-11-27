"use client";

import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import type { ChatActions } from "./chat-actions.ts";
import { ChatBlockView } from "./chat-block-view.tsx";

type ChatThreadProps = {
  actions: ChatActions;
  error: string | undefined;
  onStop: () => void;
};

export function ChatThread(props: ChatThreadProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const history = useStore(
    session.stores.activity,
    (state) => state.chats[props.actions.projectId],
  );
  const end = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  useEffect(() => {
    if (history?.version !== undefined && stickToEnd.current)
      end.current?.scrollIntoView({ block: "nearest" });
  }, [history?.version]);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3 pb-20"
      onScroll={(event) => {
        const node = event.currentTarget;
        stickToEnd.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      {history?.error && (
        <p role="alert" className="pb-3 text-danger">
          {history.error}{" "}
          <button
            type="button"
            onClick={() => session.retryChat(props.actions.projectId)}
            className="underline"
          >
            {t("chat.chat-thread.retry")}
          </button>
        </p>
      )}
      {history?.isStale && !history.error && (
        <p className="pb-3 text-ink-dim">
          {t("chat.chat-thread.loading-chat")}
        </p>
      )}
      {history && !history.isStale && history.messages.length === 0 && (
        <div className="flex flex-1 flex-col justify-end gap-y-2 pb-4">
          <p className="type-empty-headline">
            {t("chat.chat-thread.start-with-a-sentence")}
          </p>
          <p className="text-ink-dim">
            {t("chat.chat-thread.describe-an-object-or-ask-about-the-room")}
          </p>
        </div>
      )}
      {history?.messages.map((message) => (
        <article
          key={message.id}
          className="flex flex-col gap-y-2 border-line border-b py-3 first:pt-0 last:border-b-0"
          aria-label={
            message.author.kind === "user"
              ? t("chat.chat-thread.your-message")
              : t("chat.chat-thread.role-message", {
                  role: t(`activity.log.${message.author.role}`),
                })
          }
        >
          {message.author.kind === "agent" && (
            <div className="aligned-row">
              <span className="type-label">
                {t(`activity.log.${message.author.role}`)}
              </span>
              <span className="whitespace-nowrap text-right">
                {message.status === "streaming" ? (
                  <button
                    type="button"
                    onClick={props.onStop}
                    className="text-[11px] text-ink-dim underline"
                  >
                    {t("chat.chat-thread.stop")}
                  </button>
                ) : (
                  message.status !== "done" && (
                    <span className="text-[11px] text-ink-dim">
                      {t(`chat.status.${message.status}`)}
                    </span>
                  )
                )}
              </span>
            </div>
          )}
          <div className="flex items-start gap-x-2">
            {message.author.kind === "user" && (
              <span aria-hidden="true">›</span>
            )}
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-2">
              {message.blocks.map((block, index) => (
                <div
                  key={`${message.id}:${index}`}
                  className={
                    block.kind === "item"
                      ? "max-w-full"
                      : block.kind === "image" &&
                          message.blocks.filter(
                            (entry) => entry.kind === "image",
                          ).length > 1
                        ? "w-[calc(50%-4px)]"
                        : "w-full"
                  }
                >
                  <ChatBlockView
                    blockKey={JSON.stringify([
                      props.actions.projectId,
                      message.id,
                      index,
                    ])}
                    block={block}
                    actions={props.actions}
                    surveyorJobId={
                      message.author.kind === "agent" &&
                      message.author.role === "surveyor" &&
                      message.blocks[0]?.kind === "job" &&
                      message.blocks[0].jobId === message.id
                        ? message.id
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </article>
      ))}
      {props.error && (
        <p role="alert" className="py-2 text-danger">
          {props.error}
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
