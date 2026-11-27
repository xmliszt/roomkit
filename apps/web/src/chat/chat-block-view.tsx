"use client";

import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import Image from "next/image";
import Link from "next/link";
import { useStore } from "zustand";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { JobRow } from "../jobs/job-row.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { AssetBlock } from "./asset-block.tsx";
import { CaptureRequestBlock } from "./capture-request-block.tsx";
import type { ChatActions } from "./chat-actions.ts";
import { DiffBlock } from "./diff-block.tsx";
import { formatToolPayload } from "./format-tool-payload.ts";
import { getChatMediaUrl } from "./get-chat-media-url.ts";
import { getMediaSrc } from "./get-media-src.ts";
import { getNoticeText } from "./get-notice-text.ts";
import { ItemBlock } from "./item-block.tsx";
import { Markdown } from "./markdown.tsx";
import { MediaBlock } from "./media-block.tsx";
import { RenderBlock } from "./render-block.tsx";

type ChatBlockViewProps = {
  block: ChatBlock;
  actions: ChatActions;
  blockKey: string;
};

export function ChatBlockView(props: ChatBlockViewProps) {
  const t = useMessages();
  const locale = useLocale();
  const session = usePlannerSession();
  const jobId = props.block.kind === "job" ? props.block.jobId : undefined;
  const job = useStore(session.stores.jobs, (state) =>
    jobId !== undefined && Object.hasOwn(state.jobs, jobId)
      ? state.jobs[jobId]
      : undefined,
  );
  const block = props.block;
  switch (block.kind) {
    case "render":
      return <RenderBlock block={block} projectId={props.actions.projectId} />;
    case "item":
      return <ItemBlock block={block} actions={props.actions} />;
    case "text":
      return <Markdown text={block.markdown} />;
    case "image":
    case "video":
    case "file":
      return <MediaBlock block={block} projectId={props.actions.projectId} />;
    case "link": {
      const image =
        block.imageSrc &&
        (getChatMediaUrl({
          projectId: props.actions.projectId,
          media: { kind: "link", imageSrc: block.imageSrc },
        }) ??
          getMediaSrc(block.imageSrc));
      const favicon = block.faviconSrc && getMediaSrc(block.faviconSrc);
      return (
        <a
          href={/^https?:\/\//.test(block.url) ? block.url : undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-x-2 border border-line p-2"
        >
          {favicon && (
            <Image
              unoptimized
              width={64}
              height={64}
              src={favicon}
              alt=""
              className="size-4"
            />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{block.title ?? block.domain}</span>
            <span className="truncate text-ink-dim">{block.domain}</span>
          </span>
          {image && (
            <Image
              unoptimized
              width={64}
              height={64}
              src={image}
              crossOrigin="anonymous"
              alt=""
              className="size-16 object-cover"
            />
          )}
        </a>
      );
    }
    case "asset":
      return <AssetBlock block={block} actions={props.actions} />;
    case "job": {
      return job ? (
        <JobRow job={job} logs={false} />
      ) : (
        <p className="text-ink-dim">
          {t("chat.chat-block-view.job")} {block.jobId}{" "}
          {t("chat.chat-block-view.unavailable")}
        </p>
      );
    }
    case "tool":
      return (
        <details className="text-ink-dim">
          <summary
            className={`cursor-pointer break-words ${block.status === "running" ? "text-accent" : block.status === "failed" ? "text-danger" : ""}`}
          >
            {block.name.replace(/^mcp__planner__/, "")} ·{" "}
            {block.summary || t(`jobs.stage.${block.status}`)}
            {block.durationMs === undefined
              ? ""
              : ` · ${formatDecimal({ value: block.durationMs / 1000, locale, digits: 1 })} s`}
          </summary>
          <div className="mt-2 flex flex-col gap-y-2">
            {[
              {
                label: t("chat.chat-block-view.arguments"),
                value: block.arguments,
              },
              { label: t("chat.chat-block-view.result"), value: block.result },
            ].flatMap((part) =>
              part.value === undefined
                ? []
                : [
                    <div key={part.label} className="flex flex-col gap-y-1">
                      <span className="type-label">{part.label}</span>
                      <pre
                        dir="ltr"
                        className="max-h-60 overflow-auto whitespace-pre border border-line p-2 text-[11px]"
                      >
                        {formatToolPayload(part.value)}
                      </pre>
                    </div>,
                  ],
            )}
          </div>
        </details>
      );
    case "diff":
      return (
        <DiffBlock
          block={block}
          projectId={props.actions.projectId}
          blockKey={props.blockKey}
        />
      );
    case "capture-request":
      return <CaptureRequestBlock block={block} actions={props.actions} />;
    case "choice":
      return (
        <div className="flex flex-col gap-y-2">
          <p dir="auto">{block.question}</p>
          {block.options.map((option) => (
            <button
              key={option.id}
              dir="auto"
              type="button"
              disabled={
                props.actions.busy || block.selectedOptionId !== undefined
              }
              aria-pressed={block.selectedOptionId === option.id}
              onClick={() =>
                void props.actions.onSend(`${block.question}\n${option.label}`)
              }
              className="border border-line px-2 py-1 text-start hover:border-line-strong disabled:opacity-50 aria-pressed:border-accent"
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    case "notice":
      return (
        <output
          className={`flex flex-col gap-y-1 ${block.detail.kind === "error" ? "text-danger" : "text-ink-dim"}`}
        >
          <p dir="auto">! {getNoticeText({ block, t })}</p>
          {block.detail.kind === "usage-limit" && block.detail.resetAt && (
            <p>
              {t("chat.chat-block-view.resets")}{" "}
              {new Date(block.detail.resetAt).toLocaleString(locale)}
            </p>
          )}
          {block.detail.kind === "missing-requirement" &&
            block.detail.settingsSection !== "connections" && (
              <Link
                href={`/settings?from=${props.actions.projectId}${block.detail.setupFeature ? `&feature=${block.detail.setupFeature}#setup` : `#${block.detail.settingsSection}`}`}
                className="self-start underline underline-offset-2"
              >
                {block.detail.setupFeature
                  ? t("chat.chat-block-view.set-up-required-tools")
                  : t("chat.chat-block-view.settings")}
              </Link>
            )}
        </output>
      );
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}
