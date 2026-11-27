import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";

const methodNames = { trellis2: "TRELLIS.2", sam3d: "SAM 3D" } as const;

/** Return a readable title for `job`, naming its object or surface from `project` when that project is open. */
export function getJobTitle(options: {
  job: Job;
  project: Project | undefined;
  t: MessageTranslator;
}) {
  const { job, t } = options;
  const scene = options.project?.scene;
  function itemName(itemId: string) {
    return (
      scene?.items.find((item) => item.id === itemId)?.name ??
      t("jobs.title.object")
    );
  }
  switch (job.kind) {
    case "render":
      return t("jobs.title.render-photo");
    case "generation-alternative":
      return t("jobs.title.version", {
        name: itemName(job.itemId),
        method: methodNames[job.method],
      });
    case "generation":
      return t("jobs.title.model", { name: itemName(job.itemId) });
    case "surface": {
      if (job.surfaceId === "floor" || job.surfaceId === "ceiling")
        return t(`jobs.title.surface-${job.surfaceId}`);
      const index = scene
        ? getWallSegments(scene.room).findIndex(
            (segment) => segment.wall.id === job.surfaceId,
          )
        : -1;
      return index === -1
        ? t("jobs.title.surface-wall")
        : t("jobs.title.surface-wall-number", { number: index + 1 });
    }
    case "reconstruction":
      return t("jobs.title.reconstruct-room");
    case "inventory":
      return t("jobs.title.find-room-objects");
    case "bulb":
      return t("jobs.title.find-bulb", { name: itemName(job.itemId) });
    case "install":
      switch (job.target.kind) {
        case "agent":
          return job.target.cli === "claude"
            ? t("jobs.title.install-claude")
            : t("jobs.title.install-codex");
        case "uv":
          return t("jobs.title.install-uv");
        case "blender":
          return t("jobs.title.install-blender");
        case "python-env":
          return t("jobs.title.setup-python");
        case "weights-download":
          return t("jobs.title.download", { model: job.target.modelId });
        case "weights-delete":
          return t("jobs.title.delete", { model: job.target.modelId });
        default: {
          const unreachable: never = job.target;
          return unreachable;
        }
      }
    default: {
      const unreachable: never = job;
      return unreachable;
    }
  }
}
