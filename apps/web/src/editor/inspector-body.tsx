import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { Lock, LockOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";
import { useMessages } from "../i18n/use-messages.ts";
import type { BulbField } from "./bulb-field.ts";
import { ChargingPortTypePicker } from "./charging-port-type-picker.tsx";
import { ColorControls } from "./color-controls.tsx";
import { GenerationInspector } from "./generation/generation-inspector.tsx";
import { getEditedSize } from "./get-edited-size.ts";
import { LightControls } from "./light-controls.tsx";
import { NumberField } from "./number-field.tsx";
import { wallThicknessM } from "./scene/wall-thickness-m.ts";
import { ShortcutKeys } from "./shortcut-keys.tsx";

type InspectorBodyProps = {
  onBulbFieldChange?: (field: BulbField | undefined) => void;
  projectId: string;
  item: Item;
  items?: Item[];
  job: Job | undefined;
  designerBusy: boolean;
  onSendDesignerRequest: (text: string) => Promise<boolean>;
  onUpdate: (patch: ItemPatch) => boolean;
  onPreviewColor: (colorAdjust: ColorAdjust | null | undefined) => void;
  onDuplicate: () => void;
  onMirror: () => void;
  onSetLightsOn: (on: boolean) => void;
  onDuplicateMirrored: () => void;
  onDelete: () => void;
  wallLabel?: string | undefined;
};

const degreesPerRad = 180 / Math.PI;

function isPositive(value: number) {
  return value > 0;
}

function isNotNegative(value: number) {
  return value >= 0;
}

function isAny() {
  return true;
}

export function InspectorBody(props: InspectorBodyProps) {
  const t = useMessages();
  const locale = useLocale();
  const [isProportionLocked, setIsProportionLocked] = useState(false);
  const placement = props.item.placement;
  const sizeM = props.item.sizeM;
  const model = props.item.model;
  const chargingPort =
    model.kind === "asset"
      ? CHARGING_PORT_TYPES.find((entry) => entry.assetId === model.assetId)
      : undefined;

  function updatePlacement(next: Placement) {
    return props.onUpdate({ placement: next });
  }

  function updateSize(input: { axis: keyof Size; valueM: number }) {
    return props.onUpdate({
      sizeM: getEditedSize({
        sizeM,
        axis: input.axis,
        valueM: input.valueM,
        isProportionLocked,
      }),
    });
  }

  if (props.items && props.items.length > 1) {
    const items = props.items;
    const isColorMixed = items.some(
      (item) =>
        JSON.stringify(item.colorAdjust) !==
        JSON.stringify(items.at(0)?.colorAdjust),
    );
    const areAllLocked = items.every((item) => item.locked);
    const isLockMixed = items.some(
      (item) => Boolean(item.locked) !== Boolean(items.at(0)?.locked),
    );
    const lights = items.flatMap((item) => (item.light ? [item.light] : []));
    const areAllLightsOn = lights.every((light) => light.on);
    const isMirrorMixed = items.some(
      (item) => Boolean(item.mirrored) !== Boolean(items.at(0)?.mirrored),
    );
    return (
      <div data-testid="inspector-body" className="flex flex-col gap-y-3">
        <h2 className="type-panel-title">
          {items.length} {t("editor.inspector-body.selected")}
        </h2>
        <ul className="text-ink-dim">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>{item.name}</li>
          ))}
          {items.length > 5 && (
            <li>
              +{items.length - 5} {t("editor.inspector-body.more")}
            </li>
          )}
        </ul>
        <ColorControls
          mixed={isColorMixed}
          colorAdjust={isColorMixed ? undefined : props.item.colorAdjust}
          onChange={(input) => {
            if (!input.isFinal) {
              props.onPreviewColor(input.colorAdjust);
              return;
            }
            props.onPreviewColor(undefined);
            props.onUpdate({ colorAdjust: input.colorAdjust });
          }}
        />
        <div className="flex flex-col gap-y-1">
          <span className="text-ink-dim">
            {t("editor.inspector-body.lock")}{" "}
            {isLockMixed
              ? t("editor.inspector-body.mixed")
              : areAllLocked
                ? t("editor.inspector-body.locked")
                : t("editor.inspector-body.unlocked")}
          </span>
          <button
            type="button"
            className="press min-h-7 border border-line px-2"
            onClick={() => props.onUpdate({ locked: !areAllLocked })}
          >
            {areAllLocked
              ? t("editor.inspector-body.unlock-all")
              : t("editor.inspector-body.lock-all")}
          </button>
          {lights.length > 0 && (
            <>
              <span className="text-ink-dim">
                {t("editor.inspector-body.lights-on-count", {
                  on: lights.filter((light) => light.on).length,
                  total: lights.length,
                })}
              </span>
              <button
                type="button"
                className="press min-h-7 border border-line px-2"
                onClick={() => props.onSetLightsOn(!areAllLightsOn)}
              >
                {areAllLightsOn
                  ? t("editor.inspector-body.turn-lights-off")
                  : t("editor.inspector-body.turn-lights-on")}
              </button>
            </>
          )}
          <span className="text-ink-dim">
            {t("editor.inspector-body.mirror")}{" "}
            {isMirrorMixed
              ? t("editor.inspector-body.mixed")
              : props.item.mirrored
                ? t("editor.inspector-body.mirrored")
                : t("editor.inspector-body.original")}
          </span>
          <button
            type="button"
            className="press min-h-7 border border-line px-2"
            onClick={props.onMirror}
          >
            {t("editor.inspector-body.mirror-all")}
          </button>
          <button
            type="button"
            className="press min-h-7 border border-line px-2"
            disabled={items.some((item) => item.model.kind === "pending")}
            onClick={props.onDuplicate}
          >
            {t("editor.inspector-body.duplicate-all")}
          </button>
          <button
            type="button"
            className="press min-h-7 border border-line px-2 hover:text-danger"
            onClick={props.onDelete}
          >
            {t("editor.inspector-body.delete-all")}
          </button>
        </div>
      </div>
    );
  }

  const rotationField = (
    <NumberField
      label={t("editor.inspector-body.rotation")}
      value={placement.rotationRad * degreesPerRad + 0}
      unit="°"
      decimals={1}
      isAllowed={isAny}
      onCommit={(valueDeg) =>
        updatePlacement({ ...placement, rotationRad: valueDeg / degreesPerRad })
      }
    />
  );

  return (
    <div data-testid="inspector-body" className="flex flex-col gap-y-3">
      <div>
        <div className="type-label">
          {t("editor.inspector-body.selected-2")}
        </div>
        <h2 className="type-panel-title">{props.item.name}</h2>
      </div>
      <hr className="border-line" />
      {chargingPort !== undefined && (
        <ChargingPortTypePicker
          entry={chargingPort}
          onUpdate={props.onUpdate}
        />
      )}
      <div className="flex flex-col gap-y-1">
        <div className="aligned-row">
          <div className="type-label">{t("editor.inspector-body.size")}</div>
          <button
            type="button"
            aria-pressed={isProportionLocked}
            aria-label={t("editor.inspector-body.lock-proportions")}
            title={t("editor.inspector-body.lock-proportions")}
            onClick={() => setIsProportionLocked((current) => !current)}
            className="press grid size-6 place-items-center rounded-panel border border-transparent text-ink-dim hover:border-line hover:text-ink aria-pressed:border-accent aria-pressed:text-accent"
          >
            {isProportionLocked ? (
              <Lock aria-hidden="true" size={12} strokeWidth={1.5} />
            ) : (
              <LockOpen aria-hidden="true" size={12} strokeWidth={1.5} />
            )}
          </button>
        </div>
        <FieldGrid>
          {(["width", "height", "depth"] as const).map((axis) =>
            axis === "depth" && props.item.cutsOpening ? (
              <div key={axis} className="contents">
                <span className="text-ink-dim">
                  {t("editor.inspector-body.depth-in-wall")}
                </span>
                <output className="grid h-6 grid-cols-[minmax(0,1fr)_2ch] items-center gap-x-1 border border-transparent px-1.5 text-right tabular-nums">
                  {formatDecimal({
                    value: Math.min(sizeM.depth, wallThicknessM),
                    locale,
                  })}
                  <span className="text-ink-dim">m</span>
                </output>
              </div>
            ) : (
              <NumberField
                key={axis}
                label={t(`editor.measurement.${axis}`)}
                value={sizeM[axis]}
                unit="m"
                decimals={2}
                isAllowed={isPositive}
                onCommit={(valueM) => updateSize({ axis, valueM })}
              />
            ),
          )}
        </FieldGrid>
      </div>
      <div className="flex flex-col gap-y-1">
        <div className="type-label">{t("editor.inspector-body.placement")}</div>
        <FieldGrid>
          {(() => {
            switch (placement.kind) {
              case "floor":
                return (
                  <>
                    <NumberField
                      label="x"
                      value={placement.xM}
                      unit="m"
                      decimals={2}
                      isAllowed={isAny}
                      onCommit={(xM) => updatePlacement({ ...placement, xM })}
                    />
                    <NumberField
                      label="z"
                      value={placement.zM}
                      unit="m"
                      decimals={2}
                      isAllowed={isAny}
                      onCommit={(zM) => updatePlacement({ ...placement, zM })}
                    />
                    <NumberField
                      label={t("editor.inspector-body.elevation")}
                      value={placement.elevationM}
                      unit="m"
                      decimals={2}
                      isAllowed={isNotNegative}
                      onCommit={(elevationM) =>
                        updatePlacement({ ...placement, elevationM })
                      }
                    />
                    {rotationField}
                  </>
                );
              case "wall":
                return (
                  <>
                    <span className="text-ink-dim">
                      {t("editor.inspector-body.wall")}
                    </span>
                    <span className="px-1.5 text-right">
                      {props.wallLabel ?? t("editor.inspector-body.wall-2")}
                    </span>
                    <NumberField
                      label={t("editor.inspector-body.along")}
                      value={placement.alongM}
                      unit="m"
                      decimals={2}
                      isAllowed={isAny}
                      onCommit={(alongM) =>
                        updatePlacement({ ...placement, alongM })
                      }
                    />
                    <NumberField
                      label={t("editor.inspector-body.above-floor")}
                      value={placement.heightM}
                      unit="m"
                      decimals={2}
                      isAllowed={isNotNegative}
                      onCommit={(heightM) =>
                        updatePlacement({ ...placement, heightM })
                      }
                    />
                    <span className="text-ink-dim">
                      {t("editor.inspector-body.bottom-edge")}
                    </span>
                    <span
                      data-testid="bottom-edge"
                      className="px-1.5 text-right tabular-nums"
                    >
                      {formatDecimal({
                        value:
                          placement.heightM -
                          (Math.abs(
                            sizeM.width * Math.sin(placement.rotationRad),
                          ) +
                            Math.abs(
                              sizeM.height * Math.cos(placement.rotationRad),
                            )) /
                            2,
                        locale,
                      })}
                      <span className="ml-1 text-ink-dim">m</span>
                    </span>
                    {rotationField}
                  </>
                );
              case "ceiling":
                return (
                  <>
                    <NumberField
                      label="x"
                      value={placement.xM}
                      unit="m"
                      decimals={2}
                      isAllowed={isAny}
                      onCommit={(xM) => updatePlacement({ ...placement, xM })}
                    />
                    <NumberField
                      label="z"
                      value={placement.zM}
                      unit="m"
                      decimals={2}
                      isAllowed={isAny}
                      onCommit={(zM) => updatePlacement({ ...placement, zM })}
                    />
                    {rotationField}
                  </>
                );
              default: {
                const unreachable: never = placement;
                return unreachable;
              }
            }
          })()}
        </FieldGrid>
      </div>
      {placement.kind === "wall" && (
        <label className="flex min-h-7 items-center gap-x-2">
          <input
            type="checkbox"
            checked={props.item.cutsOpening ?? false}
            onChange={(event) =>
              props.onUpdate({
                cutsOpening: event.currentTarget.checked ? true : null,
              })
            }
            className="accent-accent"
          />
          {t("editor.inspector-body.cut-opening-in-wall")}{" "}
        </label>
      )}
      <ColorControls
        colorAdjust={props.item.colorAdjust}
        onChange={(input) => {
          if (!input.isFinal) {
            props.onPreviewColor(input.colorAdjust);
            return;
          }
          props.onPreviewColor(undefined);
          props.onUpdate({ colorAdjust: input.colorAdjust });
        }}
      />
      <LightControls
        onBulbFieldChange={props.onBulbFieldChange}
        projectId={props.projectId}
        item={props.item}
        onUpdate={props.onUpdate}
      />
      <hr className="border-line" />
      <div className="text-ink-dim">
        {props.item.model.kind === "pending"
          ? t("editor.inspector-body.generating", {
              stage: t(`jobs.stage.${props.job?.stage ?? "queued"}`),
            })
          : t("editor.inspector-body.model-ready")}
      </div>
      <GenerationInspector
        projectId={props.projectId}
        designerBusy={props.designerBusy}
        onSendDesignerRequest={props.onSendDesignerRequest}
        item={props.item}
        job={props.job}
        onUpdate={props.onUpdate}
      />
      <div className="flex flex-col gap-y-1">
        <button
          type="button"
          aria-pressed={props.item.locked ?? false}
          onClick={() => props.onUpdate({ locked: !props.item.locked })}
          className="press h-7 rounded-panel border border-line px-2.5 hover:border-line-strong"
        >
          {props.item.locked
            ? t("editor.inspector-body.unlock")
            : t("editor.inspector-body.lock-2")}
        </button>
        <button
          type="button"
          aria-pressed={props.item.mirrored ?? false}
          onClick={props.onMirror}
          className="press h-7 rounded-panel border border-line px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
        >
          {t("editor.inspector-body.mirror-2")}
        </button>
        <button
          type="button"
          disabled={props.item.model.kind === "pending"}
          onClick={props.onDuplicateMirrored}
          className="press h-7 rounded-panel border border-line px-2.5 hover:border-line-strong disabled:text-ink-dim disabled:hover:border-line"
        >
          {t("editor.inspector-body.duplicate-mirrored")}
        </button>
      </div>
      <div className="flex gap-x-2">
        <button
          type="button"
          disabled={props.item.model.kind === "pending"}
          onClick={props.onDuplicate}
          className="press h-7 rounded-panel border border-line px-2.5 hover:border-line-strong disabled:text-ink-dim disabled:hover:border-line"
        >
          {t("editor.inspector-body.duplicate")}{" "}
          <ShortcutKeys
            className="ml-1.5 align-middle"
            keys={["command", { letter: "D" }]}
          />
        </button>
        <button
          type="button"
          onClick={props.onDelete}
          className="press h-7 rounded-panel border border-line px-2.5 hover:border-danger hover:text-danger"
        >
          {t("editor.inspector-body.delete")}{" "}
          <ShortcutKeys className="ml-1.5 align-middle" keys={["delete"]} />
        </button>
      </div>
    </div>
  );
}

type FieldGridProps = { children: ReactNode };

function FieldGrid(props: FieldGridProps) {
  return <div className="field-grid">{props.children}</div>;
}
