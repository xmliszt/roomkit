import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { useAppLanguage } from "../i18n/use-app-language.ts";

type CaptureRoomFigureProps = {
  stage: ReconstructionJob["stage"] | undefined;
  photoCount: number;
};

const stageLabels = {
  queued: "capture.queuedStage",
  intake: "capture.intakeStage",
  geometry: "capture.geometryStage",
  layout: "capture.layoutStage",
  coverage: "capture.coverageStage",
  done: "capture.doneStage",
  failed: "capture.failedStage",
  cancelled: "capture.cancelledStage",
};

const stages = ["queued", "intake", "geometry", "layout", "coverage", "done"];
const floorTraceDurationS = 0.45;
const wallRiseDurationS = 0.6;

function project(point: { x: number; y: number; z: number }) {
  return {
    x: 240 + (point.x - point.y) * Math.cos(Math.PI / 6),
    y: 88 + (point.x + point.y) * 0.5 - point.z,
  };
}

function polygon(points: { x: number; y: number; z: number }[]) {
  return points
    .map((point) => {
      const p = project(point);
      return `${p.x},${p.y}`;
    })
    .join(" ");
}

export function CaptureRoomFigure(props: CaptureRoomFigureProps) {
  const { locale, t } = useAppLanguage();
  const plural = new Intl.PluralRules(locale);
  const reduced = useReducedMotion();
  const floorClipId = useId();
  const step = stages.indexOf(props.stage ?? "");
  const guide = props.stage === undefined || props.stage === "failed";
  const stageLabel = props.stage ? t(stageLabels[props.stage]) : "";
  const usablePhotos = t(
    plural.select(props.photoCount) === "one"
      ? "capture.usablePhotoCountOne"
      : "capture.usablePhotoCount",
    { count: props.photoCount },
  );
  const floor = [
    { x: 0, y: 0, z: 0 },
    { x: 170, y: 0, z: 0 },
    { x: 170, y: 125, z: 0 },
    { x: 0, y: 125, z: 0 },
  ];
  const walls = guide || step >= 4;
  const transition = {
    duration: wallRiseDurationS,
    delay: guide ? 0 : floorTraceDurationS,
    ease: "easeOut",
  } as const;
  return (
    <figure className="flex flex-col gap-y-2 border-y border-line py-3">
      <figcaption className="flex justify-between gap-x-3">
        <span className="type-label">
          {guide ? t("capture.guide") : t("capture.reconstruction")}
        </span>
        <span className="text-ink-dim">
          {guide ? usablePhotos : stageLabel}
        </span>
      </figcaption>
      <svg
        role="img"
        aria-label={
          guide
            ? t("capture.cornerViewpoints")
            : t("capture.reconstructionStage", { stage: stageLabel })
        }
        viewBox="80 0 430 255"
        className="h-[200px] w-full fill-bg stroke-line-strong [&_*]:[vector-effect:non-scaling-stroke]"
      >
        <title>
          {guide ? t("capture.guideTitle") : t("capture.stagesTitle")}
        </title>
        <polygon
          className="face"
          points={polygon([
            { x: 0, y: 125, z: 0 },
            { x: 170, y: 125, z: 0 },
            { x: 170, y: 125, z: -6 },
            { x: 0, y: 125, z: -6 },
          ])}
        />
        <polygon
          className="face"
          points={polygon([
            { x: 170, y: 0, z: 0 },
            { x: 170, y: 125, z: 0 },
            { x: 170, y: 125, z: -6 },
            { x: 170, y: 0, z: -6 },
          ])}
        />
        <polygon className="face top" points={polygon(floor)} />
        {Array.from({ length: 54 }, (_, index) => {
          const p = project({
            x: 12 + (index % 9) * 18,
            y: 12 + Math.floor(index / 9) * 20,
            z: 0,
          });
          return (
            <circle
              key={`${p.x}-${p.y}`}
              cx={p.x}
              cy={p.y}
              r={0.65}
              className="detail fill-line stroke-none"
            />
          );
        })}
        {!guide &&
          step >= 2 &&
          step < 4 &&
          Array.from({ length: 72 }, (_, index) => {
            const p = project({
              x: 12 + (index % 12) * 13,
              y: 10 + Math.floor(index / 12) * 20,
              z: ((index * 17) % 43) + 2,
            });
            return (
              <circle
                key={`${p.x}-${p.y}`}
                cx={p.x}
                cy={p.y}
                r={1.2}
                className="fill-accent stroke-none"
                opacity={0.4}
              />
            );
          })}
        <defs>
          <clipPath id={floorClipId}>
            <motion.rect
              x={125}
              y={80}
              width={270}
              height={170}
              initial={false}
              animate={{ scaleX: guide || step >= 3 ? 1 : 0 }}
              style={{ transformOrigin: "125px 80px" }}
              transition={{
                duration: reduced || guide ? 0 : floorTraceDurationS,
                ease: "easeOut",
              }}
            />
          </clipPath>
        </defs>
        <motion.polygon
          clipPath={`url(#${floorClipId})`}
          points={polygon(floor)}
          fill="none"
          stroke={
            step >= 3 && step < 5 ? "var(--accent)" : "var(--line-strong)"
          }
          initial={false}
          animate={{ opacity: guide || step >= 3 ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        />
        <g transform="matrix(0.8660254 0.5 0 1 240 88)">
          <motion.g
            initial={false}
            animate={{ scaleY: walls ? 1 : 0, opacity: walls ? 1 : 0 }}
            style={{ transformOrigin: "0px 0px" }}
            transition={reduced ? { duration: 0 } : transition}
          >
            <path className="face" d="M0 0V-65H170V0Z" />
            <path
              className="detail stroke-line"
              fill="none"
              d="M0 -5H170M0 -60H170M6 0V-65M164 0V-65"
            />
            <path
              className="detail stroke-line"
              fill="none"
              d="M55 -18V-48H106V-18ZM80.5 -48V-18M55 -33H106"
            />
          </motion.g>
        </g>
        <g transform="matrix(-0.8660254 0.5 0 1 240 88)">
          <motion.g
            initial={false}
            animate={{ scaleY: walls ? 1 : 0, opacity: walls ? 1 : 0 }}
            style={{ transformOrigin: "0px 0px" }}
            transition={reduced ? { duration: 0 } : transition}
          >
            <path className="face" d="M0 0V-65H125V0Z" />
            <path
              className="detail stroke-line"
              fill="none"
              d="M0 -5H125M0 -60H125M6 0V-65M119 0V-65"
            />
            <path
              className="detail stroke-line"
              fill="none"
              d="M50 0V-49H78V0M55 -22H60"
            />
          </motion.g>
        </g>
        {guide &&
          [
            { x: 24, y: 95, z: 0 },
            { x: 143, y: 95, z: 0 },
          ].map((point) => {
            const p = project(point);
            return (
              <g key={point.x} transform={`translate(${p.x} ${p.y})`}>
                <path
                  className="detail stroke-line"
                  fill="none"
                  d="M0 0L-18 -30L18 -30ZM0 0L0 -30"
                />
                <ellipse rx="6" ry="3" className="face" />
                <path fill="none" d="M0 -16L-7 3M0 -16L7 3M0 -16V6" />
                <rect
                  x="-8"
                  y="-26"
                  width="16"
                  height="11"
                  rx="1"
                  className="face"
                />
                <circle cx="0" cy="-21" r="3" className="detail" />
                <path className="detail" d="M-6 -26V-29H-1V-26" />
              </g>
            );
          })}
      </svg>
      <p className="text-[11px] text-ink-dim">
        {guide ? t("capture.guideCaption") : t("capture.stagesCaption")}
      </p>
    </figure>
  );
}
