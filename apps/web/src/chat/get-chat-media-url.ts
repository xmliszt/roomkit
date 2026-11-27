import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";

type Media =
  | { kind: "photo"; photoId: string; thumbnail: boolean }
  | { kind: "link"; imageSrc: string };

export function getChatMediaUrl(options: { projectId: string; media: Media }) {
  const project = encodeURIComponent(options.projectId);
  switch (options.media.kind) {
    case "photo":
      return getDaemonUrl({
        path: `/projects/${project}/photos/${encodeURIComponent(options.media.photoId)}${options.media.thumbnail ? "?size=thumb" : ""}`,
      });
    case "link": {
      const fileName =
        /^\.planner\/links\/([a-f0-9]{32}\.(?:jpg|png|gif|webp|avif))$/
          .exec(options.media.imageSrc)
          ?.at(1);
      return fileName
        ? getDaemonUrl({ path: `/projects/${project}/links/${fileName}` })
        : undefined;
    }
    default: {
      const unreachable: never = options.media;
      return unreachable;
    }
  }
}
