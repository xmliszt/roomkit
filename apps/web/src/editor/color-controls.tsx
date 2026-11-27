import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";
import { type FocusEvent, useRef } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { LiveInput } from "./live-input.tsx";

type ColorControlsProps = {
  colorAdjust: ColorAdjust | undefined;
  mixed?: boolean;
  onChange: (input: {
    colorAdjust: ColorAdjust | null;
    isFinal: boolean;
  }) => void;
};

type Mode = "original" | ColorAdjust["kind"];

const modes = [
  { mode: "original", label: "editor.color-controls.original" },
  { mode: "colorize", label: "editor.color-controls.colorize" },
  { mode: "shift", label: "editor.color-controls.shift" },
] as const satisfies readonly { mode: Mode; label: string }[];

const defaultColorize = {
  kind: "colorize",
  color: "#808080",
  strength: 1,
} as const satisfies ColorAdjust;

const defaultShift = {
  kind: "shift",
  hueShiftDeg: 0,
  saturation: 0,
  lightness: 0,
} as const satisfies ColorAdjust;

export function ColorControls(props: ColorControlsProps) {
  const t = useMessages();
  const pendingMode = useRef<Mode>(undefined);
  const colorAdjust = props.colorAdjust;
  const mode: Mode = colorAdjust?.kind ?? "original";

  function changeValue(input: {
    colorAdjust: ColorAdjust | null;
    isFinal: boolean;
  }) {
    if (input.isFinal) pendingMode.current = undefined;
    props.onChange(input);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (
      pendingMode.current === undefined ||
      (event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget))
    )
      return;
    if (props.mixed || pendingMode.current !== mode) {
      pendingMode.current = undefined;
      return;
    }
    changeValue({ colorAdjust: props.colorAdjust ?? null, isFinal: true });
  }

  function selectMode(next: Mode) {
    if (next === mode && !props.mixed) return;
    pendingMode.current = next;
    props.onChange({
      colorAdjust: (() => {
        switch (next) {
          case "original":
            return null;
          case "colorize":
            return defaultColorize;
          case "shift":
            return defaultShift;
          default: {
            const unreachable: never = next;
            return unreachable;
          }
        }
      })(),
      isFinal: false,
    });
  }

  return (
    <div onBlurCapture={handleBlur} className="flex flex-col gap-y-2">
      <div className="type-label">
        {t("editor.color-controls.colour")}
        {props.mixed ? t("editor.color-controls.mixed") : ""}
      </div>
      <fieldset
        aria-label={t("editor.color-controls.colour-mode")}
        className="grid grid-cols-3 rounded-panel border border-line"
      >
        {modes.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            aria-pressed={!props.mixed && mode === entry.mode}
            onClick={() => selectMode(entry.mode)}
            className="h-6 border-line not-first:border-l hover:text-ink text-ink-dim aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {t(entry.label)}
          </button>
        ))}
      </fieldset>
      {(() => {
        if (colorAdjust === undefined) return null;
        switch (colorAdjust.kind) {
          case "colorize":
            return (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
                <span className="text-ink-dim">
                  {t("editor.color-controls.colour-2")}
                </span>
                <div className="flex items-center gap-x-2">
                  <LiveInput
                    type="color"
                    aria-label={t("editor.color-controls.colorize-colour")}
                    value={colorAdjust.color}
                    onLive={(color) =>
                      changeValue({
                        colorAdjust: { ...colorAdjust, color },
                        isFinal: false,
                      })
                    }
                    onCommit={(color) =>
                      changeValue({
                        colorAdjust: { ...colorAdjust, color },
                        isFinal: true,
                      })
                    }
                    className="size-[18px] cursor-pointer rounded-panel border border-line-strong p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[1px] [&::-webkit-color-swatch]:border-0"
                  />
                  <span className="tabular-nums">{colorAdjust.color}</span>
                </div>
                <span />
                <SliderRow
                  label={t("editor.color-controls.strength")}
                  value={colorAdjust.strength}
                  min={0}
                  max={1}
                  text={`${Math.round(colorAdjust.strength * 100)}%`}
                  onChange={(input) =>
                    changeValue({
                      colorAdjust: { ...colorAdjust, strength: input.value },
                      isFinal: input.isFinal,
                    })
                  }
                />
              </div>
            );
          case "shift":
            return (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
                <SliderRow
                  label={t("editor.color-controls.hue")}
                  value={colorAdjust.hueShiftDeg}
                  min={-180}
                  max={180}
                  step={1}
                  text={`${Math.round(colorAdjust.hueShiftDeg)}°`}
                  onChange={(input) =>
                    changeValue({
                      colorAdjust: { ...colorAdjust, hueShiftDeg: input.value },
                      isFinal: input.isFinal,
                    })
                  }
                />
                <SliderRow
                  label={t("editor.color-controls.saturation")}
                  value={colorAdjust.saturation}
                  min={-1}
                  max={1}
                  text={formatOffset(colorAdjust.saturation)}
                  onChange={(input) =>
                    changeValue({
                      colorAdjust: { ...colorAdjust, saturation: input.value },
                      isFinal: input.isFinal,
                    })
                  }
                />
                <SliderRow
                  label={t("editor.color-controls.lightness")}
                  value={colorAdjust.lightness}
                  min={-1}
                  max={1}
                  text={formatOffset(colorAdjust.lightness)}
                  onChange={(input) =>
                    changeValue({
                      colorAdjust: { ...colorAdjust, lightness: input.value },
                      isFinal: input.isFinal,
                    })
                  }
                />
              </div>
            );
          default: {
            const unreachable: never = colorAdjust;
            return unreachable;
          }
        }
      })()}
    </div>
  );
}

function formatOffset(value: number) {
  const text = value.toFixed(2);
  return value > 0 ? `+${text}` : text;
}

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  text: string;
  onChange: (input: { value: number; isFinal: boolean }) => void;
};

function SliderRow(props: SliderRowProps) {
  return (
    <div className="contents">
      <span className="text-ink-dim">{props.label}</span>
      <LiveInput
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step ?? 0.01}
        value={String(props.value)}
        onLive={(value) =>
          props.onChange({ value: Number(value), isFinal: false })
        }
        onCommit={(value) =>
          props.onChange({ value: Number(value), isFinal: true })
        }
        className="h-4 w-full min-w-0 cursor-pointer accent-accent"
      />
      <span className="w-10 text-right tabular-nums">{props.text}</span>
    </div>
  );
}
