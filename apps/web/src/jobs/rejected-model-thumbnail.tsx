import Image from "next/image";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useMessages } from "../i18n/use-messages.ts";

type RejectedModelThumbnailProps = {
  projectId: string;
  jobId: string;
};

export function RejectedModelThumbnail(props: RejectedModelThumbnailProps) {
  const t = useMessages();
  return (
    <Image
      unoptimized
      width={64}
      height={64}
      crossOrigin="anonymous"
      alt={t("jobs.rejected-model-thumbnail.rejected-model")}
      className="size-16 shrink-0 border border-line object-contain"
      src={getDaemonUrl({
        path: `/projects/${encodeURIComponent(props.projectId)}/rejected/${encodeURIComponent(props.jobId)}/thumb.png`,
      })}
    />
  );
}
