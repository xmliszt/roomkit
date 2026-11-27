import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import {
  type ScaleSource,
  ScaleSourcesSchema,
} from "@planner/shared/src/reconstruction/scale-source-schema.ts";
import { useState } from "react";
import { parseDecimal } from "../i18n/parse-decimal.ts";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { FurnitureBoxPicker } from "./furniture-box-picker.tsx";

type ScaleFormProps = {
  projectId: string;
  photos: Photo[];
  sources: ScaleSource[];
  disabled: boolean;
  running: boolean;
  onSave: (sources: ScaleSource[]) => Promise<void>;
};

const axisLabels = {
  width: "capture.widthAxis",
  depth: "capture.depthAxis",
  height: "capture.heightAxis",
};

type ScaleError =
  | {
      kind: "validation";
      key:
        | "capture.furnitureBoxRequired"
        | "capture.sizeAlreadySaved"
        | "capture.invalidScale";
    }
  | { kind: "sourceLimit"; limit: number }
  | { kind: "request"; detail: string };

export function ScaleForm(props: ScaleFormProps) {
  const { locale, t } = useAppLanguage();
  const dimension = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  const pixels = new Intl.NumberFormat(locale, { useGrouping: false });
  const [kind, setKind] = useState<"measurement" | "furniture">("measurement");
  const [axis, setAxis] = useState<"width" | "depth" | "height">("height");
  const [length, setLength] = useState("");
  const [photoId, setPhotoId] = useState("");
  const [box, setBox] = useState<[number, number, number, number]>([
    0, 0, 0, 0,
  ]);
  const [floorStanding, setFloorStanding] = useState(true);
  const [error, setError] = useState<ScaleError>();
  const [busy, setBusy] = useState(false);
  const photos = props.photos.filter((photo) => photo.kind === "accepted");
  const photo = photos.find((entry) => entry.photoId === photoId);
  const inputClass = "h-7 min-w-0 rounded-panel border border-line bg-bg px-2";
  async function save(sources: ScaleSource[]) {
    setBusy(true);
    setError(undefined);
    try {
      await props.onSave(sources);
      return true;
    } catch (caught) {
      setError({
        kind: "request",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function addSource() {
    const lengthM = parseDecimal(length);
    if (lengthM === undefined || lengthM < 0.001) {
      setError({ kind: "validation", key: "capture.invalidScale" });
      return;
    }
    const source: ScaleSource =
      kind === "measurement"
        ? { kind, axis, lengthM }
        : { kind, photoId, box, axis, lengthM, floorStanding };
    if (
      kind === "furniture" &&
      (!photo || box[2] > photo.widthPx || box[3] > photo.heightPx)
    ) {
      setError({ kind: "validation", key: "capture.furnitureBoxRequired" });
      return;
    }
    if (
      props.sources.some(
        (entry) => JSON.stringify(entry) === JSON.stringify(source),
      )
    ) {
      setError({ kind: "validation", key: "capture.sizeAlreadySaved" });
      return;
    }
    const parsed = ScaleSourcesSchema.safeParse([...props.sources, source]);
    if (!parsed.success) {
      const limit = parsed.error.issues.find(
        (issue) =>
          issue.code === "too_big" &&
          issue.origin === "array" &&
          issue.path.length === 0,
      );
      setError(
        limit?.code === "too_big"
          ? { kind: "sourceLimit", limit: Number(limit.maximum) }
          : { kind: "validation", key: "capture.invalidScale" },
      );
      return;
    }
    if (await save(parsed.data)) setLength("");
  }
  return (
    <div className="flex flex-col gap-y-4">
      <p className="text-ink-dim">{t("capture.scaleHint")}</p>
      {props.running && (
        <output className="text-ink-dim">
          {t("capture.scaleWhenRunning")}
        </output>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void addSource();
        }}
      >
        <fieldset
          disabled={props.disabled || busy}
          className="flex flex-col gap-y-3"
        >
          <legend className="sr-only">{t("capture.addScaleSource")}</legend>
          <label className="flex flex-col gap-y-1">
            <span className="type-label">{t("capture.scaleSource")}</span>
            <select
              aria-label={t("capture.scaleSource")}
              className={inputClass}
              value={kind}
              onChange={(event) => {
                if (
                  event.target.value === "measurement" ||
                  event.target.value === "furniture"
                )
                  setKind(event.target.value);
              }}
            >
              <option value="measurement">
                {t("capture.roomMeasurement")}
              </option>
              <option value="furniture">{t("capture.furnitureSize")}</option>
            </select>
          </label>
          {kind === "furniture" && (
            <>
              <label className="flex flex-col gap-y-1">
                <span className="type-label">
                  {t("capture.referencePhoto")}
                </span>
                <select
                  aria-label={t("capture.referencePhoto")}
                  className={inputClass}
                  value={photoId}
                  onChange={(event) => {
                    setPhotoId(event.target.value);
                    setBox([0, 0, 0, 0]);
                  }}
                >
                  <option value="">{t("capture.choosePhoto")}</option>
                  {photos.map((entry, index) => (
                    <option key={entry.photoId} value={entry.photoId}>
                      {t("capture.photoOption", {
                        number: index + 1,
                        width: pixels.format(entry.widthPx),
                        height: pixels.format(entry.heightPx),
                      })}
                    </option>
                  ))}
                </select>
              </label>
              {photo && (
                <FurnitureBoxPicker
                  key={photo.photoId}
                  projectId={props.projectId}
                  photo={photo}
                  box={box}
                  onChange={setBox}
                />
              )}
              <label className="flex items-center gap-x-2">
                <input
                  type="checkbox"
                  checked={floorStanding}
                  onChange={(event) => setFloorStanding(event.target.checked)}
                />
                {t("capture.floorStanding")}
              </label>
            </>
          )}
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-x-3">
            <label className="flex min-w-0 flex-col gap-y-1">
              <span className="type-label">{t("capture.axis")}</span>
              <select
                aria-label={t("capture.axis")}
                className={inputClass}
                value={axis}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    value === "width" ||
                    value === "depth" ||
                    value === "height"
                  )
                    setAxis(value);
                }}
              >
                <option value="height">
                  {kind === "measurement"
                    ? t("projects.ceilingHeight")
                    : t("capture.height")}
                </option>
                <option value="width">{t("projects.width")}</option>
                <option value="depth">{t("projects.depth")}</option>
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-y-1">
              <span className="type-label">{t("capture.sizeMeters")}</span>
              <input
                className={inputClass}
                inputMode="decimal"
                required
                value={length}
                onChange={(event) => setLength(event.target.value)}
              />
            </label>
            <RowButton type="submit">
              {busy ? t("settings.saving") : t("capture.addSize")}
            </RowButton>
          </div>
          {kind === "measurement" && (
            <p className="text-ink-dim">{t("capture.widthDepthHint")}</p>
          )}
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error.kind === "validation"
            ? t(error.key)
            : error.kind === "sourceLimit"
              ? t("capture.tooManyScaleSources", { limit: error.limit })
              : t("capture.saveScaleFailed", { detail: error.detail })}
        </p>
      )}
      {props.sources.length > 0 && (
        <div>
          <RowButton
            disabled={props.disabled || busy}
            onClick={() => {
              void save([]);
            }}
          >
            {t("capture.clearSizes")}
          </RowButton>
        </div>
      )}
      <ul aria-label={t("capture.savedSources")} className="flex flex-col">
        {props.sources.map((source, index) => (
          <li
            key={JSON.stringify(source)}
            className="scale-row border-line border-b py-2"
          >
            <span className="scale-label">
              {source.label ??
                (source.kind === "furniture"
                  ? t("capture.furniture")
                  : source.kind === "measurement"
                    ? t("capture.room")
                    : t("capture.distance"))}{" "}
              ·{" "}
              {source.kind !== "distance"
                ? `${t(axisLabels[source.axis])} · `
                : ""}
            </span>
            <span className="scale-value whitespace-nowrap">
              {dimension.format(source.lengthM)} m
            </span>
            <RowButton
              disabled={props.disabled || busy}
              label={t("capture.removeScaleSource", { number: index + 1 })}
              onClick={() => {
                void save(
                  props.sources.filter(
                    (_, sourceIndex) => sourceIndex !== index,
                  ),
                );
              }}
            >
              {t("capture.remove")}
            </RowButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
