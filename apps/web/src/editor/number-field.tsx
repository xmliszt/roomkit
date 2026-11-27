import { useId, useRef, useState } from "react";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { parseDecimal } from "../i18n/parse-decimal.ts";
import { useLocale } from "../i18n/use-locale.ts";

type NumberFieldProps = {
  label: string;
  value: number;
  unit: string;
  decimals: number;
  isAllowed: (value: number) => boolean;
  onCommit: (value: number) => boolean;
};

export function NumberField(props: NumberFieldProps) {
  const locale = useLocale();
  const id = useId();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const isRevertingRef = useRef(false);
  const shown = formatDecimal({
    value: props.value,
    locale,
    digits: props.decimals,
  });
  const parsed = draft === undefined ? undefined : parseDecimal(draft);
  const isInvalid =
    draft !== undefined && (parsed === undefined || !props.isAllowed(parsed));

  function commit() {
    if (draft === undefined) return true;
    if (parsed === undefined || !props.isAllowed(parsed)) return false;
    setDraft(undefined);
    if (parsed === props.value) return true;
    return props.onCommit(parsed);
  }

  return (
    <div className="contents">
      <label htmlFor={id} className="self-center text-ink-dim">
        {props.label}
      </label>
      <div
        className={`grid h-6 grid-cols-[minmax(0,1fr)_2ch] items-center gap-x-1 rounded-panel border px-1.5 ${isInvalid ? "border-danger" : "border-transparent hover:border-line focus-within:border-accent"}`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={isInvalid}
          value={draft ?? shown}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.select();
            } else if (event.key === "Escape") {
              event.preventDefault();
              isRevertingRef.current = true;
              setDraft(undefined);
              event.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (isRevertingRef.current || !commit()) setDraft(undefined);
            isRevertingRef.current = false;
          }}
          className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
        />
        <span className="text-ink-dim">{props.unit}</span>
      </div>
    </div>
  );
}
