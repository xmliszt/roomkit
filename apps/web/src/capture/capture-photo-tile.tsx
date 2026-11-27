import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import { useState } from "react";
import { getChatMediaUrl } from "../chat/get-chat-media-url.ts";
import { useAppLanguage } from "../i18n/use-app-language.ts";

type CapturePhotoTileProps = {
  projectId: string;
  photo: Photo;
  number: number;
};

export function CapturePhotoTile(props: CapturePhotoTileProps) {
  const { locale, t } = useAppLanguage();
  const dimensions = new Intl.NumberFormat(locale, { useGrouping: false });
  const [failed, setFailed] = useState(false);
  return (
    <figure className="flex min-w-0 flex-col gap-y-2">
      {props.photo.kind === "rejected" || failed ? (
        <div className="flex aspect-[4/3] items-center justify-center border border-line text-danger">
          {props.photo.kind === "rejected"
            ? t("capture.tooBlurry")
            : t("capture.photoUnavailable")}
        </div>
      ) : (
        <img
          className="aspect-[4/3] w-full border border-line object-cover"
          crossOrigin="anonymous"
          src={getChatMediaUrl({
            projectId: props.projectId,
            media: {
              kind: "photo",
              photoId: props.photo.photoId,
              thumbnail: true,
            },
          })}
          alt={t("capture.roomViewNumber", { number: props.number })}
          onError={() => setFailed(true)}
        />
      )}
      <figcaption className="aligned-row [--row-value-width:14ch] text-[11px] text-ink-dim">
        <span className="whitespace-nowrap">
          {t("capture.photoNumber", { number: props.number })}
        </span>
        <span className="whitespace-nowrap text-right tabular-nums">
          {dimensions.format(props.photo.widthPx)} ×{" "}
          {dimensions.format(props.photo.heightPx)}
        </span>
      </figcaption>
    </figure>
  );
}
