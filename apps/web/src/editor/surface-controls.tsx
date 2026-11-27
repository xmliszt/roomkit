import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import {
  type SurfaceMaterial,
  SurfaceMaterialSchema,
} from "@planner/shared/src/scene/surface-material-schema.ts";
import { useId } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { getSurfaceAssetSize } from "./get-surface-asset-size.ts";
import { LiveInput } from "./live-input.tsx";
import { getSurfaceColor } from "./scene/get-surface-color.ts";
import { SurfaceAssetPicker } from "./surface-asset-picker.tsx";
import { SurfaceNumberInput } from "./surface-number-input.tsx";
import { withSurfaceSize } from "./with-surface-size.ts";

const swatches = [
  { label: "editor.surface-controls.swatch-chalk", color: "#fcfbf9" },
  { label: "editor.surface-controls.swatch-linen", color: "#e8dfcf" },
  { label: "editor.surface-controls.swatch-sand", color: "#d2bea0" },
  { label: "editor.surface-controls.swatch-stone", color: "#b6b2a8" },
  { label: "editor.surface-controls.swatch-taupe", color: "#9e8c7c" },
  { label: "editor.surface-controls.swatch-charcoal", color: "#444b4c" },
  { label: "editor.surface-controls.swatch-sage", color: "#9caf91" },
  { label: "editor.surface-controls.swatch-olive", color: "#777d55" },
  { label: "editor.surface-controls.swatch-clay", color: "#bc8068" },
  { label: "editor.surface-controls.swatch-rose", color: "#d5b4ad" },
  { label: "editor.surface-controls.swatch-mist", color: "#b3c7ce" },
  { label: "editor.surface-controls.swatch-slate", color: "#677e91" },
];

type SurfaceControlsProps = {
  room: Room;
  assets: SurfaceAsset[];
  projectId: string;
  loading: boolean;
  failed: boolean;
  paintOnly?: boolean;
  surfaceId: string;
  onChange: (input: {
    surfaceId: string;
    color: string;
    material: SurfaceMaterial | null;
    isFinal: boolean;
  }) => void;
  onApplyWalls: () => void;
  onCancel: () => void;
};

function isMaterialKind(
  value: string,
): value is SurfaceMaterial["kind"] | "flat" {
  return (
    value === "flat" ||
    value === "paint" ||
    value === "tiles" ||
    value === "planks" ||
    value === "texture"
  );
}

export function SurfaceControls(props: SurfaceControlsProps) {
  const t = useMessages();
  const fieldId = useId();
  const stored = Object.hasOwn(props.room.surfaces, props.surfaceId)
    ? props.room.surfaces[props.surfaceId]
    : undefined;
  const material = stored?.material;
  const color = getSurfaceColor({
    room: props.room,
    surfaceId: props.surfaceId,
  });
  const textureAssets = props.assets;
  const isLoadingEmpty = props.loading && textureAssets.length === 0;
  const selectedAsset =
    material && material.kind !== "paint"
      ? textureAssets.find((asset) => asset.assetId === material.textureAssetId)
      : undefined;
  function chooseAsset(asset: SurfaceAsset | undefined) {
    if (!material || material.kind === "paint") return;
    if (!asset) {
      if (material.kind !== "texture")
        change({ material: { ...material, textureAssetId: undefined } });
      return;
    }
    const size = getSurfaceAssetSize(asset);
    const common = {
      textureAssetId: asset.assetId,
      roughness: asset.roughness,
    };
    const nextMaterial =
      material.kind === "texture"
        ? { ...material, ...common }
        : { ...material, ...common, baseColor: asset.color };
    change({ material: withSurfaceSize({ material: nextMaterial, size }) });
  }

  function change(options: { material: SurfaceMaterial; isFinal?: boolean }) {
    const next = options.material;
    const isFinal = options.isFinal ?? true;
    if (!SurfaceMaterialSchema.safeParse(next).success) return;
    props.onChange({
      surfaceId: props.surfaceId,
      color:
        next.kind === "paint"
          ? next.color
          : next.kind === "texture"
            ? color
            : next.baseColor,
      material: next,
      isFinal,
    });
  }
  function selectKind(kind: SurfaceMaterial["kind"] | "flat") {
    switch (kind) {
      case "flat":
        props.onChange({
          surfaceId: props.surfaceId,
          color,
          material: null,
          isFinal: true,
        });
        return;
      case "paint":
        change({ material: { kind, color, finish: "matte" } });
        return;
      case "tiles":
        change({
          material: {
            kind,
            tileSizeM: { u: 0.8, v: 0.8 },
            groutWidthM: 0.004,
            groutColor: "#b6b2a8",
            baseColor: color,
            roughness: 0.3,
          },
        });
        return;
      case "planks":
        change({
          material: {
            kind,
            plankSizeM: { u: 0.18, v: 1.2 },
            baseColor: "#b69a74",
            roughness: 0.65,
          },
        });
        return;
      case "texture": {
        const asset = selectedAsset ?? textureAssets.at(0);
        if (asset)
          change({
            material: {
              kind,
              textureAssetId: asset.assetId,
              repeatSizeM: getSurfaceAssetSize(asset),
              roughness: asset.roughness,
            },
          });
        return;
      }
      default: {
        const unreachable: never = kind;
        return unreachable;
      }
    }
  }
  const repeat =
    material?.kind === "tiles"
      ? material.tileSizeM
      : material?.kind === "planks"
        ? material.plankSizeM
        : material?.kind === "texture"
          ? material.repeatSizeM
          : undefined;
  function changeSize(input: {
    axis: "u" | "v";
    value: string;
    isFinal: boolean;
  }) {
    if (!repeat || !material || material.kind === "paint") return;
    const size = { ...repeat, [input.axis]: Number(input.value) };
    change({
      material: withSurfaceSize({ material, size }),
      isFinal: input.isFinal,
    });
  }

  return (
    <section
      aria-label={t("editor.surface-controls.surface-material")}
      className="flex flex-col gap-y-3 border-t border-line pt-3"
    >
      {!props.paintOnly && (
        <label className="aligned-row">
          <span
            className="truncate"
            title={t("editor.surface-controls.material")}
          >
            {t("editor.surface-controls.material")}
          </span>
          <select
            aria-label={t("editor.surface-controls.material")}
            className="h-7 max-w-44 border border-line bg-bg px-1"
            value={material?.kind ?? "flat"}
            onChange={(event) => {
              if (isMaterialKind(event.target.value))
                selectKind(event.target.value);
            }}
          >
            <option value="flat">
              {t("editor.surface-controls.flat-colour")}
            </option>
            <option value="paint">{t("editor.surface-controls.paint")}</option>
            <option value="tiles">{t("editor.surface-controls.tiles")}</option>
            <option value="planks">
              {t("editor.surface-controls.planks")}
            </option>
            {isLoadingEmpty ? (
              material?.kind === "texture" && (
                <option value="texture" hidden>
                  {t("editor.surface-controls.loading-textures")}
                </option>
              )
            ) : (
              <option value="texture" disabled={textureAssets.length === 0}>
                {t("editor.surface-controls.wallpaper-texture")}
              </option>
            )}
          </select>
        </label>
      )}
      {material?.kind === "paint" && (
        <>
          <fieldset
            className="grid grid-cols-6 gap-x-2 gap-y-2"
            aria-label={t("editor.surface-controls.paint-swatches")}
          >
            {swatches.map((swatch) => (
              <button
                type="button"
                key={swatch.color}
                aria-label={t(swatch.label)}
                title={t(swatch.label)}
                aria-pressed={material.color.toLowerCase() === swatch.color}
                className="press h-7 border border-line-strong aria-pressed:outline aria-pressed:outline-accent aria-pressed:outline-offset-2"
                style={{ backgroundColor: swatch.color }}
                onClick={() =>
                  change({ material: { ...material, color: swatch.color } })
                }
              />
            ))}
          </fieldset>
          <label htmlFor={`${fieldId}-1`} className="aligned-row">
            <span
              className="truncate"
              title={t("editor.surface-controls.paint-colour")}
            >
              {t("editor.surface-controls.paint-colour")}
            </span>
            <LiveInput
              id={`${fieldId}-1`}
              type="color"
              value={material.color}
              onLive={(value) =>
                change({
                  material: { ...material, color: value },
                  isFinal: false,
                })
              }
              onCommit={(value) =>
                change({ material: { ...material, color: value } })
              }
              className="h-7 w-16 border border-line"
            />
          </label>
          <label className="aligned-row">
            <span
              className="truncate"
              title={t("editor.surface-controls.finish")}
            >
              {t("editor.surface-controls.finish")}
            </span>
            <select
              value={material.finish}
              className="h-7 border border-line bg-bg px-1"
              onChange={(event) => {
                const finish = event.target.value;
                if (
                  finish === "matte" ||
                  finish === "eggshell" ||
                  finish === "satin"
                )
                  change({ material: { ...material, finish } });
              }}
            >
              <option value="matte">
                {t("editor.surface-controls.matte")}
              </option>
              <option value="eggshell">
                {t("editor.surface-controls.eggshell")}
              </option>
              <option value="satin">
                {t("editor.surface-controls.satin")}
              </option>
            </select>
          </label>
        </>
      )}
      {repeat && (
        <div className="flex flex-col gap-y-1">
          {(["u", "v"] as const).map((axis) => (
            <label
              htmlFor={`${fieldId}-${axis}`}
              key={axis}
              className="aligned-row"
            >
              <span
                className="truncate"
                title={`${axis === "u" ? t("editor.surface-controls.repeat-width") : t("editor.surface-controls.repeat-length")} · m`}
              >
                {axis === "u"
                  ? t("editor.surface-controls.repeat-width")
                  : t("editor.surface-controls.repeat-length")}{" "}
                · m
              </span>
              <SurfaceNumberInput
                onCancel={props.onCancel}
                id={`${fieldId}-${axis}`}
                min={0.05}
                max={3}
                step={0.01}
                value={repeat[axis]}
                onLive={(value) => changeSize({ axis, value, isFinal: false })}
                onCommit={(value) => changeSize({ axis, value, isFinal: true })}
              />
            </label>
          ))}
          {selectedAsset && (
            <button
              type="button"
              className="press h-7 border border-line hover:border-line-strong"
              onClick={() => {
                if (!material || material.kind === "paint") return;
                const size = getSurfaceAssetSize(selectedAsset);
                change({ material: withSurfaceSize({ material, size }) });
              }}
            >
              {t("editor.surface-controls.reset-scale")}
            </button>
          )}
        </div>
      )}
      {material?.kind === "tiles" && (
        <>
          <label htmlFor={`${fieldId}-3`} className="aligned-row">
            <span
              className="truncate"
              title={t("editor.surface-controls.grout-width-m")}
            >
              {t("editor.surface-controls.grout-width-m")}
            </span>
            <SurfaceNumberInput
              onCancel={props.onCancel}
              id={`${fieldId}-3`}
              min={0}
              max={Math.min(
                0.05,
                material.tileSizeM.u - 0.001,
                material.tileSizeM.v - 0.001,
              )}
              step={0.001}
              value={material.groutWidthM}
              onLive={(value) =>
                change({
                  material: { ...material, groutWidthM: Number(value) },
                  isFinal: false,
                })
              }
              onCommit={(value) =>
                change({
                  material: { ...material, groutWidthM: Number(value) },
                })
              }
            />
          </label>
          <label htmlFor={`${fieldId}-4`} className="aligned-row">
            <span
              className="truncate"
              title={t("editor.surface-controls.grout-colour")}
            >
              {t("editor.surface-controls.grout-colour")}
            </span>
            <LiveInput
              id={`${fieldId}-4`}
              type="color"
              value={material.groutColor}
              onLive={(value) =>
                change({
                  material: { ...material, groutColor: value },
                  isFinal: false,
                })
              }
              onCommit={(value) =>
                change({ material: { ...material, groutColor: value } })
              }
              className="h-7 w-16 border border-line"
            />
          </label>
        </>
      )}
      {material && material.kind !== "paint" && (
        <>
          <label htmlFor={`${fieldId}-5`} className="aligned-row">
            <span
              className="truncate"
              title={t("editor.surface-controls.roughness")}
            >
              {t("editor.surface-controls.roughness")}
            </span>
            <LiveInput
              id={`${fieldId}-5`}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={String(material.roughness)}
              onLive={(value) =>
                change({
                  material: { ...material, roughness: Number(value) },
                  isFinal: false,
                })
              }
              onCommit={(value) =>
                change({ material: { ...material, roughness: Number(value) } })
              }
              className="w-28 accent-accent"
            />
          </label>
          {(material.kind === "texture" || textureAssets.length > 0) &&
            !isLoadingEmpty && (
              <SurfaceAssetPicker
                assets={textureAssets}
                loading={props.loading}
                projectId={props.projectId}
                room={props.room}
                assetId={material.textureAssetId}
                optional={material.kind !== "texture"}
                onChange={chooseAsset}
              />
            )}
        </>
      )}
      {!props.paintOnly && isLoadingEmpty && (
        <output>{t("editor.surface-controls.loading-textures")}</output>
      )}
      {!props.paintOnly &&
        !props.loading &&
        !props.failed &&
        textureAssets.length === 0 && (
          <p className="text-[10px] leading-4 text-ink-dim">
            {t("editor.surface-controls.ask-in-chat-to-create-wallpaper-or-a")}
          </p>
        )}
      {props.surfaceId !== "floor" && props.surfaceId !== "ceiling" && (
        <button
          type="button"
          onClick={props.onApplyWalls}
          className="press h-7 border border-line hover:border-line-strong"
        >
          {t("editor.surface-controls.apply-to-all-walls")}
        </button>
      )}
    </section>
  );
}
