import { useState } from "react";

type SurfaceNumberInputProps = {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCancel: () => void;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
};

export function SurfaceNumberInput(props: SurfaceNumberInputProps) {
  const [draft, setDraft] = useState<string>();
  const parsed =
    draft === undefined || draft.trim() === "" ? undefined : Number(draft);
  const isValid =
    parsed !== undefined &&
    Number.isFinite(parsed) &&
    parsed >= props.min &&
    parsed <= props.max;
  function commit() {
    if (draft === undefined) return;
    if (isValid) props.onCommit(String(parsed));
    else props.onCancel();
    setDraft(undefined);
  }
  return (
    <input
      id={props.id}
      type="number"
      min={props.min}
      max={props.max}
      step={props.step}
      value={draft ?? String(props.value)}
      aria-invalid={draft !== undefined && !isValid}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        if (
          value.trim() !== "" &&
          Number(value) >= props.min &&
          Number(value) <= props.max
        )
          props.onLive(value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onCancel();
          setDraft(undefined);
        }
      }}
      className="h-7 w-20 text-right tabular-nums border border-line bg-bg px-1 aria-invalid:border-danger"
    />
  );
}
