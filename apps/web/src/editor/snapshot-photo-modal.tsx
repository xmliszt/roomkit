import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useStore } from "zustand";
import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { panelEnter } from "./interface-motion.ts";

type SnapshotPhotoModalProps = {
  projectId: string;
  png: Blob;
  view: RenderView;
  onClose: () => void;
  onQueued: () => void;
};

export function SnapshotPhotoModal(props: SnapshotPhotoModalProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startingRef = useRef(false);
  const [imageUrl, setImageUrl] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string>();
  const job = useStore(session.stores.jobs, (state) =>
    jobId ? state.jobs[jobId] : undefined,
  );
  const isRunning =
    isStarting ||
    (jobId !== undefined &&
      (!job ||
        job.stage === "queued" ||
        job.stage === "exporting" ||
        job.stage === "rendering"));

  useEffect(() => {
    const url = URL.createObjectURL(props.png);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [props.png]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  async function renderPhoto() {
    if (startingRef.current || isRunning) return;
    startingRef.current = true;
    setIsStarting(true);
    setError(undefined);
    try {
      const ack = await session.command({
        type: "render.start",
        projectId: props.projectId,
        view: props.view,
      });
      if (!ack.ok) throw new Error(ack.error);
      setJobId(z.object({ jobId: IdSchema }).parse(ack.result).jobId);
      props.onQueued();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={t("editor.snapshot-photo-modal.snapshot-photo")}
      onCancel={props.onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="z-modal m-auto max-h-[92dvh] w-[min(960px,90vw)] overflow-y-auto overscroll-contain border-0 bg-transparent p-4 text-ink backdrop:bg-ink/40"
    >
      <motion.div
        initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={panelEnter}
        className="flex flex-col items-center gap-y-4"
      >
        {imageUrl && (
          <div className="bg-white p-1 pb-2 shadow-[0_8px_32px_rgb(0_0_0/0.2),0_2px_8px_rgb(0_0_0/0.12)]">
            <img
              crossOrigin="anonymous"
              src={
                job?.stage === "done"
                  ? getDaemonUrl({
                      path: `/projects/${props.projectId}/renders/${job.id}.png`,
                    })
                  : imageUrl
              }
              alt={
                job?.stage === "done"
                  ? t("editor.snapshot-photo-modal.rendered-photo-of-the-room")
                  : t("editor.snapshot-photo-modal.snapshot-of-the-room")
              }
              className="max-h-[68dvh] max-w-full object-contain"
            />
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-2">
          <button
            type="button"
            disabled={isRunning}
            onClick={() => void renderPhoto()}
            className="press min-h-9 rounded-panel border border-line-strong bg-bg px-3 hover:border-ink disabled:text-ink-dim"
          >
            {isRunning
              ? t("editor.snapshot-photo-modal.rendering", {
                  status: job
                    ? `${t(`jobs.stage.${job.stage}`)} · ${Math.round(job.progress * 100)}%`
                    : t("editor.snapshot-photo-modal.queueing"),
                })
              : t("editor.snapshot-photo-modal.render-realistic-photo")}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="press min-h-9 rounded-panel border border-line-strong bg-bg px-3 hover:border-ink"
          >
            {t("editor.snapshot-photo-modal.close")}
          </button>
        </div>
        <output className="bg-bg px-3 text-center">
          {isRunning &&
            t(
              "editor.snapshot-photo-modal.rendering-about-2-minutes-the-photo-will-appear",
            )}
          {job?.stage === "done" &&
            t("editor.snapshot-photo-modal.the-photo-is-ready-in-chat")}
          {job?.stage === "cancelled" &&
            t("editor.snapshot-photo-modal.render-cancelled")}
        </output>
        {(error || job?.error) && (
          <p role="alert" className="bg-bg px-3 text-danger">
            {error ?? job?.error}
          </p>
        )}
      </motion.div>
    </dialog>
  );
}
