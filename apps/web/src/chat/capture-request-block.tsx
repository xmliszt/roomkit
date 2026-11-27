import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import Link from "next/link";
import { type ChangeEvent, useRef, useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import type { ChatActions } from "./chat-actions.ts";
import { getCaptureRequestMap } from "./get-capture-request-map.ts";
import { uploadCapturePhoto } from "./upload-capture-photo.ts";

type CaptureRequestBlockProps = {
  block: Extract<ChatBlock, { kind: "capture-request" }>;
  actions: ChatActions;
};

export function CaptureRequestBlock(props: CaptureRequestBlockProps) {
  const t = useMessages();
  const room = props.actions.scene.room;
  const map = getCaptureRequestMap({ room, block: props.block });
  const isFloor = props.block.wallId === "floor";
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading" }
    | { kind: "uploaded"; fileName: string }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  function choosePhoto() {
    inputRef.current?.click();
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);
    event.currentTarget.value = "";
    if (!file || uploadingRef.current) return;
    uploadingRef.current = true;
    setStatus({ kind: "uploading" });
    try {
      await uploadCapturePhoto({
        projectId: props.actions.projectId,
        file,
      });
      setStatus({ kind: "uploaded", fileName: file.name });
    } catch (error) {
      setStatus({
        kind: "failed",
        message:
          error instanceof Error
            ? error.message
            : t("chat.capture-request-block.photo-upload-failed"),
      });
    } finally {
      uploadingRef.current = false;
    }
  }

  return (
    <div className="flex items-start gap-x-3 border border-line p-3">
      <svg
        role="img"
        aria-label={
          isFloor
            ? t(
                "chat.capture-request-block.photo-position-looking-down-at-the-floor",
              )
            : t("chat.capture-request-block.photo-position-facing-wallid", {
                wallId: props.block.wallId,
              })
        }
        viewBox={map.viewBox}
        className="size-24 shrink-0 fill-none stroke-ink-dim"
      >
        <title>
          {isFloor
            ? t("chat.capture-request-block.stand-at-the-dot-and-look-down")
            : t(
                "chat.capture-request-block.stand-at-the-dot-and-face-the-marked",
              )}
        </title>
        <polygon
          points={map.floorPoints}
          className={
            isFloor ? "fill-accent/10 stroke-accent" : "fill-bg stroke-line"
          }
          vectorEffect="non-scaling-stroke"
        />
        {room.walls.map((wall, index) => {
          const end = room.walls.at((index + 1) % room.walls.length);
          return (
            end && (
              <line
                key={wall.id}
                x1={wall.startM.x}
                y1={wall.startM.z}
                x2={end.startM.x}
                y2={end.startM.z}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={wall.kind === "inferred" ? "3 3" : undefined}
                className={
                  wall.id === props.block.wallId ? "stroke-accent" : undefined
                }
              />
            )
          );
        })}
        {!isFloor && map.arrowPoints && (
          <>
            <path
              d={`M ${props.block.standM.x} ${props.block.standM.z} L ${props.block.lookAtM.x} ${props.block.lookAtM.z}`}
              className="stroke-accent"
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              points={map.arrowPoints}
              className="fill-accent stroke-none"
            />
          </>
        )}
        {isFloor && (
          <circle
            cx={props.block.standM.x}
            cy={props.block.standM.z}
            r={map.dotRadiusM * 2.5}
            className="stroke-accent"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle
          cx={props.block.standM.x}
          cy={props.block.standM.z}
          r={map.dotRadiusM}
          className="fill-accent stroke-none"
        />
      </svg>
      <div className="flex min-w-0 flex-col gap-y-2">
        <p>{props.block.text}</p>
        <p className="text-[11px] text-ink-dim">
          {isFloor
            ? t("chat.capture-request-block.stand-at-the-dot-look-down")
            : t(
                "chat.capture-request-block.stand-at-the-dot-face-the-marked-wall",
              )}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
          aria-label={t("chat.capture-request-block.upload-capture-photo")}
          className="hidden"
          onChange={uploadPhoto}
          disabled={status.kind === "uploading"}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <RowButton
            onClick={choosePhoto}
            disabled={status.kind === "uploading"}
          >
            {status.kind === "uploading"
              ? t("chat.capture-request-block.uploading")
              : t("chat.capture-request-block.upload-photo")}
          </RowButton>
          <Link
            href={`/projects/${props.actions.projectId}/capture`}
            className="underline underline-offset-2"
          >
            {t("chat.capture-request-block.review-capture")}
          </Link>
        </div>
        {status.kind === "uploaded" && (
          <output className="break-words text-[11px] text-ink-dim">
            {status.fileName}{" "}
            {t(
              "chat.capture-request-block.added-ready-for-reconstruction",
            )}{" "}
          </output>
        )}
        {status.kind === "uploading" && (
          <output className="text-[11px] text-ink-dim">
            {t("chat.capture-request-block.uploading-capture-photo")}
          </output>
        )}
        {status.kind === "failed" && (
          <p role="alert" className="break-words text-[11px] text-danger">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
