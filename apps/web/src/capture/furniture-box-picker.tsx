import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import { type PointerEvent, useRef, useState } from "react";
import { getChatMediaUrl } from "../chat/get-chat-media-url.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { getPhotoBox } from "./get-photo-box.ts";

type FurnitureBoxPickerProps = {
  projectId: string;
  photo: Photo;
  box: [number, number, number, number];
  onChange: (box: [number, number, number, number]) => void;
};

export function FurnitureBoxPicker(props: FurnitureBoxPickerProps) {
  const t = useMessages();
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  function position(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * props.photo.widthPx,
      y: ((event.clientY - bounds.top) / bounds.height) * props.photo.heightPx,
    };
  }
  function update(event: PointerEvent<HTMLButtonElement>) {
    if (!start.current) return;
    props.onChange(
      getPhotoBox({
        start: start.current,
        end: position(event),
        widthPx: props.photo.widthPx,
        heightPx: props.photo.heightPx,
      }),
    );
  }
  return (
    <div className="flex flex-col gap-y-2">
      <p className="text-ink-dim">{t("capture.furnitureBoxHelp")}</p>
      <button
        type="button"
        aria-label={t("capture.drawFurnitureBox")}
        disabled={!ready}
        className="relative block w-full touch-none cursor-crosshair overflow-hidden border border-line"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          start.current = position(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event);
        }}
        onPointerMove={update}
        onPointerUp={(event) => {
          update(event);
          start.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          start.current = undefined;
        }}
      >
        <img
          src={getChatMediaUrl({
            projectId: props.projectId,
            media: {
              kind: "photo",
              photoId: props.photo.photoId,
              thumbnail: false,
            },
          })}
          crossOrigin="anonymous"
          alt={t("capture.furnitureReference")}
          draggable={false}
          className="block h-auto w-full"
          onLoad={(event) => setReady(event.currentTarget.naturalWidth > 0)}
          onError={() => {
            setReady(false);
            setFailed(true);
          }}
        />
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${props.photo.widthPx} ${props.photo.heightPx}`}
          className="pointer-events-none absolute inset-0 size-full"
        >
          <rect
            x={props.box[0]}
            y={props.box[1]}
            width={Math.max(0, props.box[2] - props.box[0])}
            height={Math.max(0, props.box[3] - props.box[1])}
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </button>
      {failed && (
        <p role="alert" className="text-danger">
          {t("capture.chooseAnotherPhoto")}
        </p>
      )}
      <div className="grid grid-cols-4 gap-x-3">
        {(
          [
            "capture.edgeLeft",
            "capture.edgeTop",
            "capture.edgeRight",
            "capture.edgeBottom",
          ] as const
        ).map((label, index) => (
          <label key={label} className="flex min-w-0 flex-col gap-y-1">
            <span className="type-label">{t(label)} · px</span>
            <input
              type="number"
              min={0}
              step={1}
              aria-label={t("capture.edgeAria", { edge: t(label) })}
              value={props.box[index]}
              className="h-7 w-full border border-line bg-transparent px-2"
              onChange={(event) => {
                const next: [number, number, number, number] = [...props.box];
                next[index] = Number(event.target.value);
                props.onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
