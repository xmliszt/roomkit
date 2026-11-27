"use client";

import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import Image from "next/image";
import { useState } from "react";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { formatBytes } from "../ui/format-bytes.ts";
import { Modal } from "../ui/modal.tsx";
import { getChatMediaUrl } from "./get-chat-media-url.ts";
import { getMediaSrc } from "./get-media-src.ts";
import { Markdown } from "./markdown.tsx";

type MediaBlockProps = {
  block: Extract<ChatBlock, { kind: "image" | "video" | "file" }>;
  projectId: string;
};

export function MediaBlock(props: MediaBlockProps) {
  const t = useMessages();
  const locale = useLocale();
  const block = props.block;
  const src =
    block.kind === "image"
      ? getChatMediaUrl({
          projectId: props.projectId,
          media: { kind: "photo", photoId: block.photoId, thumbnail: false },
        })
      : getMediaSrc(block.src);
  const thumbnail =
    block.kind === "image"
      ? getChatMediaUrl({
          projectId: props.projectId,
          media: { kind: "photo", photoId: block.photoId, thumbnail: true },
        })
      : src;
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const caption = `${block.fileName} · ${formatBytes({ bytes: block.sizeBytes, locale })}`;
  const markdown = (() => {
    if (block.kind !== "file" || !src || !/^data:text\//.test(src))
      return undefined;
    try {
      return new TextDecoder().decode(
        Uint8Array.from(atob(src.slice(src.indexOf(",") + 1)), (char) =>
          char.charCodeAt(0),
        ),
      );
    } catch {
      return undefined;
    }
  })();
  return (
    <figure className="flex min-w-0 flex-col gap-y-1.5">
      {src === undefined ? (
        <div className="border border-line p-2 text-ink-dim">
          {block.kind === "file" ? block.fileType.toUpperCase() : block.kind}{" "}
          {t("chat.media-block.preview-unavailable")}{" "}
        </div>
      ) : block.kind === "image" ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={t("chat.media-block.open-filename", {
            fileName: block.fileName,
          })}
          className="self-start border border-line"
        >
          <Image
            unoptimized
            width={480}
            height={320}
            src={thumbnail ?? src}
            crossOrigin="anonymous"
            alt={block.fileName}
            className="h-auto w-auto max-h-60 max-w-full object-contain"
          />
        </button>
      ) : block.kind === "video" ? (
        block.format === "gif" ? (
          <button
            type="button"
            onPointerEnter={() => setIsHovering(true)}
            onPointerLeave={() => setIsHovering(false)}
            onFocus={() => setIsHovering(true)}
            onBlur={() => setIsHovering(false)}
            onClick={() => setIsOpen(true)}
            className="border border-line p-2"
          >
            {isHovering ? (
              <Image
                unoptimized
                width={480}
                height={320}
                src={src}
                crossOrigin="anonymous"
                alt={block.fileName}
                className="h-auto w-auto max-h-60 max-w-full object-contain"
              />
            ) : (
              t("chat.media-block.filename-hover-to-play", {
                fileName: block.fileName,
              })
            )}
          </button>
        ) : (
          <video
            src={src}
            controls
            aria-label={block.fileName}
            className="max-h-60 border border-line"
          >
            <track kind="captions" />
          </video>
        )
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="aligned-row border border-line p-2"
        >
          <span className="truncate" title={block.fileName}>
            {block.fileType.toUpperCase()} · {block.fileName}
          </span>
          <span>{t("chat.media-block.open")}</span>
        </button>
      )}
      <figcaption className="break-all text-[11px] text-ink-dim">
        {caption}
      </figcaption>
      {isOpen && src && (
        <Modal
          title={block.fileName}
          onClose={() => setIsOpen(false)}
          wide={block.kind !== "file"}
          side={block.kind === "file"}
        >
          <div className="p-4">
            {block.kind === "image" || block.kind === "video" ? (
              <Image
                unoptimized
                width={480}
                height={320}
                src={src}
                crossOrigin="anonymous"
                alt={block.fileName}
                className="mx-auto h-auto w-auto max-h-[65dvh] max-w-full object-contain"
              />
            ) : markdown !== undefined ? (
              <Markdown text={markdown} />
            ) : /^data:application\/pdf;/.test(src) ? (
              <iframe
                src={src}
                title={block.fileName}
                className="h-[65dvh] w-full border-0"
              />
            ) : (
              <a href={src} download={block.fileName} className="underline">
                {t("chat.media-block.download")} {block.fileName}
              </a>
            )}
          </div>
        </Modal>
      )}
    </figure>
  );
}
