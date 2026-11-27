"use client";

import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import Image from "next/image";
import {
  type PointerEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { getAssetUrl } from "../items/get-asset-url.ts";
import { AssetPreviewContext } from "./asset-preview-context.ts";

type AssetPreviewProps = {
  projectId: string;
  assetId: string;
  sizeM: Size;
  thumbnailUrl?: string | undefined;
  name?: string;
  compact?: boolean;
};

export function AssetPreview(props: AssetPreviewProps) {
  const t = useMessages();
  const preview = useContext(AssetPreviewContext);
  const target = useRef<HTMLSpanElement>(null);
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const thumbnail =
    props.thumbnailUrl ?? getAssetUrl({ ...props, fileName: "thumb.png" });

  useEffect(() => {
    const node = target.current;
    return () => {
      if (node) preview?.current?.stop(node);
    };
  }, [preview]);

  function start() {
    if (target.current)
      preview?.current?.start({
        ...props,
        target: target.current,
        view: { kind: "turntable" },
      });
  }

  function stop() {
    if (target.current) preview?.current?.stop(target.current);
  }

  function handlePointerLeave(event: PointerEvent<HTMLButtonElement>) {
    if (document.activeElement !== event.currentTarget) stop();
  }

  function handleThumbnailError() {
    setFailedThumbnail(thumbnail);
  }

  return (
    <button
      type="button"
      className={`relative ${props.compact ? "size-16" : "size-24"} shrink-0 overflow-hidden border border-line`}
      aria-label={
        props.name
          ? t("chat.asset-preview.named-preview", { name: props.name })
          : t("chat.asset-preview.preview")
      }
      onPointerEnter={start}
      onPointerLeave={handlePointerLeave}
      onFocus={start}
      onBlur={stop}
    >
      {failedThumbnail === thumbnail ? (
        <span className="block p-2 text-[11px] text-ink-dim">
          {t("chat.asset-preview.preview-unavailable")}
        </span>
      ) : (
        <Image
          unoptimized
          width={96}
          height={96}
          crossOrigin="anonymous"
          alt=""
          src={thumbnail}
          onError={handleThumbnailError}
          className="size-full object-contain"
        />
      )}
      <span ref={target} className="pointer-events-none absolute inset-0" />
    </button>
  );
}
