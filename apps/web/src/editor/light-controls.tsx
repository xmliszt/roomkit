import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import { getBeamWay } from "@planner/shared/src/scene/get-beam-way.ts";
import { getDefaultLight } from "@planner/shared/src/scene/get-default-light.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import {
  BeamSchema,
  LightSchema,
} from "@planner/shared/src/scene/light-schema.ts";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import type { BulbField } from "./bulb-field.ts";
import { NumberField } from "./number-field.tsx";

type LightControlsProps = {
  onBulbFieldChange: ((field: BulbField | undefined) => void) | undefined;
  projectId: string;
  item: Item;
  onUpdate: (patch: ItemPatch) => boolean;
};

const switchClass =
  "relative h-4 w-7 shrink-0 appearance-none rounded-full border border-line-strong bg-bg before:absolute before:top-0.5 before:left-0.5 before:size-2.5 before:rounded-full before:bg-ink-dim checked:border-accent checked:bg-accent checked:before:left-3.5 checked:before:bg-bg";

function isLumens(value: number) {
  return LightSchema.shape.lumens.safeParse(value).success;
}

function isBeamAngle(value: number) {
  return BeamSchema.shape.angleDeg.safeParse(value).success;
}

function isPercent(value: number) {
  return LightSchema.shape.emitter.shape.x.safeParse(value / 100).success;
}

function isTemperature(value: number) {
  return LightSchema.shape.temperatureK.safeParse(value).success;
}

export function LightControls(props: LightControlsProps) {
  const t = useMessages();
  const light = props.item.light;
  const hoveredField = useRef<BulbField>(undefined);
  const focusedField = useRef<BulbField>(undefined);
  const hasLight = light !== undefined;
  useEffect(() => {
    if (!hasLight) props.onBulbFieldChange?.(undefined);
    return () => {
      focusedField.current = undefined;
      hoveredField.current = undefined;
      props.onBulbFieldChange?.(undefined);
    };
  }, [hasLight, props.onBulbFieldChange]);

  function fieldEvents(field: BulbField) {
    function update(options: {
      kind: "hover" | "focus";
      value: BulbField | undefined;
    }) {
      if (options.kind === "hover") hoveredField.current = options.value;
      else focusedField.current = options.value;
      props.onBulbFieldChange?.(focusedField.current ?? hoveredField.current);
    }
    return {
      onPointerEnter: () => update({ kind: "hover", value: field }),
      onPointerLeave: () => update({ kind: "hover", value: undefined }),
      onFocus: () => update({ kind: "focus", value: field }),
      onBlur: () => update({ kind: "focus", value: undefined }),
    };
  }
  const session = usePlannerSession();
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const [error, setError] = useState<string>();
  const bulbJob = Object.values(jobs)
    .flatMap((job) =>
      job.kind === "bulb" &&
      job.projectId === props.projectId &&
      job.itemId === props.item.id
        ? [job]
        : [],
    )
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  const isFinding =
    bulbJob !== undefined &&
    ["queued", "rendering", "asking"].includes(bulbJob.stage);

  async function findBulb() {
    setError(undefined);
    const ack = await session.command({
      type: "bulb.find",
      projectId: props.projectId,
      itemId: props.item.id,
    });
    if (!ack.ok) setError(ack.error);
  }

  return (
    <div data-testid="light-controls" className="flex flex-col gap-y-1">
      <label className="aligned-row">
        <span className="type-label">
          {t("editor.light-controls.light-source")}
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={light !== undefined}
          checked={light !== undefined}
          onChange={(event) => {
            const isAdding = event.currentTarget.checked;
            const isApplied = props.onUpdate({
              light: isAdding ? getDefaultLight(props.item.placement) : null,
            });
            if (isAdding && isApplied) void findBulb();
          }}
          className={switchClass}
        />
      </label>
      {light !== undefined && (
        <div className="field-grid grid-cols-[minmax(0,1fr)_112px]">
          <label htmlFor={`${props.item.id}-light-on`} className="text-ink-dim">
            {t("editor.light-controls.on")}
          </label>
          <span className="flex justify-end px-1.5">
            <input
              id={`${props.item.id}-light-on`}
              type="checkbox"
              role="switch"
              aria-checked={light.on}
              checked={light.on}
              onChange={(event) =>
                props.onUpdate({
                  light: { ...light, on: event.currentTarget.checked },
                })
              }
              className={switchClass}
            />
          </span>
          <NumberField
            label={t("editor.light-controls.brightness")}
            value={light.lumens}
            unit="lm"
            decimals={0}
            isAllowed={isLumens}
            onCommit={(lumens) =>
              props.onUpdate({ light: { ...light, lumens } })
            }
          />
          <NumberField
            label={t("editor.light-controls.warmth")}
            value={light.temperatureK}
            unit="K"
            decimals={0}
            isAllowed={isTemperature}
            onCommit={(temperatureK) =>
              props.onUpdate({ light: { ...light, temperatureK } })
            }
          />
          {(["x", "y", "z"] as const).map((axis) => (
            <div
              key={axis}
              className="contents"
              data-bulb-axis={axis}
              {...fieldEvents(axis)}
            >
              <NumberField
                label={t("editor.light-controls.bulb-axis", { axis: axis })}
                value={light.emitter[axis] * 100}
                unit="%"
                decimals={0}
                isAllowed={isPercent}
                onCommit={(percent) =>
                  props.onUpdate({
                    light: {
                      ...light,
                      emitter: { ...light.emitter, [axis]: percent / 100 },
                    },
                  })
                }
              />
            </div>
          ))}
          <label htmlFor={`${props.item.id}-beam`} className="text-ink-dim">
            {t("editor.light-controls.beam")}
          </label>
          <select
            id={`${props.item.id}-beam`}
            data-bulb-axis="beam"
            {...fieldEvents("beam")}
            value={getBeamWay(light.beam)}
            onChange={(event) => {
              const way = event.currentTarget.value;
              const { beam, ...withoutBeam } = light;
              if (way === "all") {
                props.onUpdate({ light: withoutBeam });
                return;
              }
              props.onUpdate({
                light: {
                  ...withoutBeam,
                  beam: {
                    direction: { x: 0, y: way === "up" ? 1 : -1, z: 0 },
                    angleDeg: beam?.angleDeg ?? 90,
                  },
                },
              });
            }}
            className="h-6 rounded-panel border border-transparent bg-transparent px-1 text-right hover:border-line"
          >
            <option value="down">{t("editor.light-controls.down")}</option>
            <option value="up">{t("editor.light-controls.up")}</option>
            {getBeamWay(light.beam) === "angled" && (
              <option value="angled">
                {t("editor.light-controls.angled")}
              </option>
            )}
            <option value="all">{t("editor.light-controls.all")}</option>
          </select>
          <label htmlFor={`${props.item.id}-shade`} className="text-ink-dim">
            {t("editor.light-controls.shade")}
          </label>
          <select
            id={`${props.item.id}-shade`}
            value={light.shade ?? "opaque"}
            onChange={(event) => {
              const shade = LightSchema.shape.shade.parse(
                event.currentTarget.value,
              );
              props.onUpdate({ light: { ...light, shade } });
            }}
            className="h-6 rounded-panel border border-transparent bg-transparent px-1 text-right hover:border-line"
          >
            <option value="opaque">{t("editor.light-controls.opaque")}</option>
            <option value="translucent">
              {t("editor.light-controls.translucent")}
            </option>
          </select>
          {light.beam !== undefined && (
            <div
              className="contents"
              data-bulb-axis="beam"
              {...fieldEvents("beam")}
            >
              <NumberField
                label={t("editor.light-controls.beam-angle")}
                value={light.beam.angleDeg}
                unit="°"
                decimals={0}
                isAllowed={isBeamAngle}
                onCommit={(angleDeg) =>
                  light.beam !== undefined &&
                  props.onUpdate({
                    light: { ...light, beam: { ...light.beam, angleDeg } },
                  })
                }
              />
            </div>
          )}
          <div className="col-span-2 aligned-row [--row-value-width:128px]">
            <span
              className="min-w-0 truncate text-ink-dim"
              data-testid="bulb-state"
            >
              {bulbJob
                ? t("editor.light-controls.bulb-stage", {
                    stage:
                      bulbJob.lastLogLine ?? t(`jobs.stage.${bulbJob.stage}`),
                  })
                : t("editor.light-controls.bulb")}
            </span>
            <button
              type="button"
              disabled={isFinding}
              onClick={() => void findBulb()}
              className="press h-6 whitespace-nowrap rounded-panel border border-line px-2 hover:border-line-strong disabled:text-ink-dim disabled:hover:border-line"
            >
              {isFinding
                ? t("editor.light-controls.finding")
                : t("editor.light-controls.find-bulb-again")}
            </button>
          </div>
          {error && (
            <span role="alert" className="col-span-2 text-danger">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
