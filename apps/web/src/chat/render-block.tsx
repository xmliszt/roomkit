"use client";

import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import Image from "next/image";
import { useState } from "react";
import { downloadBlob } from "../daemon-http/download-blob.ts";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { Modal } from "../ui/modal.tsx";

type RenderBlockProps = {
  block: Extract<ChatBlock, { kind: "render" }>;
  projectId: string;
};

export function RenderBlock(props: RenderBlockProps) {
  const t = useMessages();
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = getDaemonUrl({
    path: `/projects/${props.projectId}/renders/${props.block.jobId}.png`,
  });
  async function download() {
    setFailed(false);
    try {
      const response = await fetch(`${src}?download=1`);
      if (!response.ok) throw new Error(String(response.status));
      downloadBlob({
        blob: await response.blob(),
        fileName: props.block.fileName,
      });
    } catch {
      setFailed(true);
    }
  }
  if (missing)
    return (
      <p className="text-ink-dim">
        {t("chat.render-block.render-file-missing")}
      </p>
    );
  return (
    <figure className="flex min-w-0 flex-col gap-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("chat.render-block.open-rendered-photo")}
        className="self-start outline outline-1 outline-line -outline-offset-1"
      >
        <Image
          unoptimized
          width={props.block.widthPx}
          height={props.block.heightPx}
          src={src}
          crossOrigin="anonymous"
          alt={t("chat.render-block.rendered-photo-of-the-room")}
          onError={() => setMissing(true)}
          className="h-auto max-h-60 w-auto max-w-full object-contain"
        />
      </button>
      <figcaption>
        <button
          type="button"
          onClick={() => void download()}
          className="underline underline-offset-2"
        >
          {t("chat.render-block.download-photo")} {props.block.widthPx} ×{" "}
          {props.block.heightPx}
        </button>
      </figcaption>
      {failed && (
        <p role="alert" className="text-danger">
          {t("chat.render-block.download-failed")}
        </p>
      )}
      {open && (
        <Modal
          wide
          title={t("chat.render-block.rendered-photo")}
          onClose={() => setOpen(false)}
        >
          <Image
            unoptimized
            width={props.block.widthPx}
            height={props.block.heightPx}
            src={src}
            crossOrigin="anonymous"
            alt={t("chat.render-block.rendered-photo-of-the-room-full-size")}
            className="h-auto max-w-full"
          />
        </Modal>
      )}
    </figure>
  );
}
