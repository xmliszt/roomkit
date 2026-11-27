"use client";

import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import { ProjectIdSchema } from "@planner/shared/src/project/project-id-schema.ts";
import { PhotosListResultSchema } from "@planner/shared/src/protocol/photos-list-result-schema.ts";
import { ReconstructionScaleResultSchema } from "@planner/shared/src/protocol/reconstruction-scale-result-schema.ts";
import type { ScaleSource } from "@planner/shared/src/reconstruction/scale-source-schema.ts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useStore } from "zustand";
import { uploadCapturePhoto } from "../chat/upload-capture-photo.ts";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { JobRow } from "../jobs/job-row.tsx";
import { PageColumn } from "../pages-ui/page-column.tsx";
import { RowButton } from "../pages-ui/row-button.tsx";
import { RowSection } from "../pages-ui/row-section.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { CapturePhotoTile } from "./capture-photo-tile.tsx";
import { CaptureRoomFigure } from "./capture-room-figure.tsx";
import { ScaleForm } from "./scale-form.tsx";

type CapturePageProps = { projectId: string };

type UploadStatus =
  | { kind: "uploading"; current: number; total: number }
  | { kind: "complete"; count: number };

type CaptureError = {
  key:
    | "capture.loadFailed"
    | "capture.uploadFailed"
    | "capture.reconstructionFailed";
  detail: string;
};

export function CapturePage(props: CapturePageProps) {
  const { locale, t } = useAppLanguage();
  const plural = new Intl.PluralRules(locale);
  const session = usePlannerSession();
  const router = useRouter();
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const snapshotAt = useStore(session.stores.snapshot, (state) => state.at);
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const project = useStore(
    session.stores.projects,
    (state) => state.opened[props.projectId]?.project,
  );
  const openError = useStore(
    session.stores.projects,
    (state) => state.openErrors[props.projectId],
  );
  const job = Object.values(jobs)
    .filter(
      (entry): entry is ReconstructionJob =>
        entry.kind === "reconstruction" && entry.projectId === props.projectId,
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .at(0);
  const running =
    job !== undefined && job.stage !== "done" && job.stage !== "failed";
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sources, setSources] = useState<ScaleSource[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string>();
  const readKey = `${props.projectId}:${snapshotAt}:${refresh}:${job?.id}:${job?.stage}`;
  const ready = loadedKey === readKey && connection === "open";
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<CaptureError>();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>();
  const photoCount = photos.length;
  const photoStatus = (() => {
    if (uploadStatus?.kind === "uploading") {
      return t("capture.uploadProgress", {
        current: uploadStatus.current,
        total: uploadStatus.total,
      });
    }
    if (uploadStatus?.kind === "complete") {
      const count = uploadStatus.count;
      return t(
        plural.select(count) === "one"
          ? "capture.photosAddedOne"
          : "capture.photosAdded",
        { count },
      );
    }
    return ready
      ? t(
          plural.select(photoCount) === "one"
            ? "capture.photoCountOne"
            : "capture.photoCount",
          { count: photoCount },
        )
      : t("capture.loadingPhotos");
  })();
  const uploadLock = useRef(false);
  const [activeJobId, setActiveJobId] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const valid = ProjectIdSchema.safeParse(props.projectId).success;
  useEffect(() => {
    if (valid) return session.watchProject(props.projectId);
  }, [session, props.projectId, valid]);
  useEffect(() => {
    if (!valid || connection !== "open") {
      setLoadedKey(undefined);
      return;
    }
    let cancelled = false;
    setLoadedKey(undefined);
    Promise.all([
      session.command({ type: "photos.list", projectId: props.projectId }),
      session.command({
        type: "reconstruction.scale.get",
        projectId: props.projectId,
      }),
    ])
      .then(([photoAck, scaleAck]) => {
        if (cancelled) return;
        if (!photoAck.ok) throw new Error(photoAck.error);
        if (!scaleAck.ok) throw new Error(scaleAck.error);
        setPhotos(
          PhotosListResultSchema.parse(photoAck.result).photos.filter(
            (photo) => photo.origin === "capture",
          ),
        );
        setSources(
          ReconstructionScaleResultSchema.parse(scaleAck.result).sources,
        );
        setLoadedKey(readKey);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError({
            key: "capture.loadFailed",
            detail: caught instanceof Error ? caught.message : String(caught),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [session, props.projectId, valid, connection, readKey]);
  useEffect(() => {
    if (job && job.stage !== "done" && job.stage !== "failed")
      setActiveJobId(job.id);
    if (job?.stage === "done" && activeJobId === job.id) {
      setActiveJobId(undefined);
      router.push(`/projects/${props.projectId}`);
    }
  }, [job, router, props.projectId, activeJobId]);
  async function upload(files: File[]) {
    if (uploadLock.current || connection !== "open") return;
    uploadLock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      for (const [index, file] of files.entries()) {
        setUploadStatus({
          kind: "uploading",
          current: index + 1,
          total: files.length,
        });
        await uploadCapturePhoto({ projectId: props.projectId, file });
      }
      setUploadStatus({ kind: "complete", count: files.length });
    } catch (caught) {
      setUploadStatus(undefined);
      setError({
        key: "capture.uploadFailed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      uploadLock.current = false;
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  }
  async function saveScale(next: ScaleSource[]) {
    const ack = await session.command({
      type: "reconstruction.scale.set",
      projectId: props.projectId,
      sources: next,
    });
    if (!ack.ok) throw new Error(ack.error);
    setSources(ReconstructionScaleResultSchema.parse(ack.result).sources);
  }
  async function start() {
    setStarting(true);
    setError(undefined);
    try {
      const ack = await session.command({
        type: "reconstruction.start",
        projectId: props.projectId,
      });
      if (!ack.ok) throw new Error(ack.error);
      setActiveJobId(z.object({ jobId: z.string() }).parse(ack.result).jobId);
    } catch (caught) {
      setError({
        key: "capture.reconstructionFailed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setStarting(false);
    }
  }
  return (
    <PageColumn title={t("capture.title")}>
      <div className="flex items-center justify-between gap-x-4">
        <span className="text-ink-dim">
          {project?.name ?? t("capture.roomPhotos")}
        </span>
        <Link
          href={valid ? `/projects/${props.projectId}` : "/"}
          className="underline underline-offset-4"
        >
          {valid ? t("capture.openEditor") : t("capture.backToProjects")}
        </Link>
      </div>
      {!valid || openError ? (
        <p role="alert" className="text-danger">
          {openError
            ? t("capture.openFailed", { detail: openError })
            : t("capture.invalidProject")}
        </p>
      ) : (
        <>
          {connection !== "open" && (
            <output className="text-ink-dim">{t("capture.connecting")}</output>
          )}
          <CaptureRoomFigure
            key={job?.id ?? "guide"}
            stage={job?.stage}
            photoCount={
              photos.filter((photo) => photo.kind === "accepted").length
            }
          />
          <RowSection title={t("capture.photos")}>
            <div className="flex flex-col gap-y-4 py-3">
              <p className="text-ink-dim">{t("capture.photoGuide")}</p>
              <fieldset
                aria-label={t("capture.uploadRoomPhotos")}
                className="flex flex-col items-center gap-y-3 border border-line border-dashed px-4 py-6"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!busy) void upload(Array.from(event.dataTransfer.files));
                }}
              >
                <p>{t("capture.dropRoomPhotos")}</p>
                <RowButton
                  disabled={busy || connection !== "open"}
                  onClick={() => input.current?.click()}
                >
                  {busy ? t("capture.uploading") : t("capture.addPhotos")}
                </RowButton>
                <span className="text-[11px] text-ink-dim">
                  {t("capture.photoFormats")}
                </span>
                <input
                  ref={input}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
                  aria-label={t("capture.roomPhotos")}
                  className="sr-only"
                  disabled={busy || connection !== "open"}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    if (files.length) void upload(files);
                  }}
                />
              </fieldset>
              <output className="text-ink-dim">{photoStatus}</output>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                {photos.map((photo, index) => (
                  <CapturePhotoTile
                    key={`${photo.photoId}-${photo.kind}`}
                    projectId={props.projectId}
                    photo={photo}
                    number={index + 1}
                  />
                ))}
              </div>
            </div>
          </RowSection>
          <RowSection title={t("capture.scale")}>
            <ScaleForm
              projectId={props.projectId}
              photos={photos}
              sources={sources}
              disabled={!ready || busy || starting}
              running={running}
              onSave={saveScale}
            />
          </RowSection>
          <RowSection title={t("capture.reconstruction")}>
            <div className="flex flex-col gap-y-3 py-3">
              <p className="text-ink-dim">{t("capture.reconstructionHint")}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <RowButton
                  disabled={!ready || busy || starting || running}
                  onClick={() => {
                    void start();
                  }}
                >
                  {starting
                    ? t("capture.starting")
                    : running
                      ? t("capture.reconstructing")
                      : t("capture.startReconstruction")}
                </RowButton>
                <Link
                  href={`/settings?from=${props.projectId}&feature=reconstruction&returnTo=capture#setup`}
                  className="underline underline-offset-2"
                >
                  {t("capture.setupTools")}
                </Link>
              </div>
              {job && <JobRow job={job} expanded />}
              {error && (
                <p role="alert" className="text-danger">
                  {t(error.key, { detail: error.detail })}
                </p>
              )}
            </div>
          </RowSection>
        </>
      )}
    </PageColumn>
  );
}
