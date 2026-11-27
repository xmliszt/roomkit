import type { Project } from "@planner/shared/src/project/project-schema.ts";
import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";

type OpenedEntry = { project: Project; isStale: boolean } | undefined;

type CameraResend =
  | { kind: "keep" }
  | { kind: "forget" }
  | { kind: "resend"; camera: Camera };

function isSame(options: { a: Camera; b: Camera }) {
  return JSON.stringify(options.a) === JSON.stringify(options.b);
}

/** Return what to do with the camera this tab moved but may not have saved, given the project entry before and after a store change: `resend` it after a reopen that lost it, `forget` it once it is saved or another writer saved a newer camera, otherwise `keep` it. */
export function getCameraResend(options: {
  previous: OpenedEntry;
  current: OpenedEntry;
  moved: Camera | undefined;
  pendingRequestCount: number;
}): CameraResend {
  const { previous, current, moved } = options;
  if (moved === undefined || current === undefined || current.isStale) {
    return { kind: "keep" };
  }
  const saved = current.project.scene.camera;
  const isSaved = isSame({ a: saved, b: moved });
  if (previous === undefined || previous.isStale) {
    return isSaved ? { kind: "forget" } : { kind: "resend", camera: moved };
  }
  if (isSaved && options.pendingRequestCount === 0) {
    return { kind: "forget" };
  }
  const changedByOther =
    !isSame({ a: previous.project.scene.camera, b: saved }) && !isSaved;
  return changedByOther ? { kind: "forget" } : { kind: "keep" };
}
