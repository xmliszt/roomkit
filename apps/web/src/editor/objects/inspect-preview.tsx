import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import Image from "next/image";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AssetPreviewContext } from "../../chat/asset-preview-context.ts";
import { useMessages } from "../../i18n/use-messages.ts";

type InspectPreviewProps = {
  projectId: string;
  assetId: string;
  sizeM: Size;
  thumbnailUrl: string;
  name: string;
};

export function InspectPreview(props: InspectPreviewProps) {
  const t = useMessages();
  const preview = useContext(AssetPreviewContext);
  const target = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);
  const { projectId, assetId } = props;
  const { width, height, depth } = props.sizeM;
  const sizeRef = useRef(props.sizeM);

  const start = useCallback(() => {
    const node = target.current;
    if (!node || !preview?.current) return;
    setIsActive(true);
    preview.current.start({
      projectId,
      assetId,
      sizeM: sizeRef.current,
      target: node,
      view: { kind: "orbit" },
      onStop: () => setIsActive(false),
    });
  }, [preview, projectId, assetId]);

  useEffect(() => {
    sizeRef.current = { width, height, depth };
    if (target.current)
      preview?.current?.update({
        target: target.current,
        sizeM: { width, height, depth },
      });
  }, [preview, width, height, depth]);

  useEffect(() => {
    const node = target.current;
    start();
    return () => {
      if (node) preview?.current?.stop(node);
    };
  }, [preview, start]);

  return (
    <div
      ref={target}
      role="img"
      aria-label={t(
        "editor.inspect-preview.name-inspect-drag-to-orbit-scroll-to-zoom",
        { name: props.name },
      )}
      data-active={isActive}
      onPointerEnter={isActive ? undefined : start}
      className="relative aspect-square w-full max-w-[240px] cursor-grab touch-none overflow-hidden border border-line active:cursor-grabbing [&>canvas]:absolute [&>canvas]:inset-0"
    >
      <Image
        unoptimized
        width={240}
        height={240}
        crossOrigin="anonymous"
        alt=""
        src={props.thumbnailUrl}
        className="pointer-events-none size-full object-contain"
      />
    </div>
  );
}
