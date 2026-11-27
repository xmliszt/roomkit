import {
  type AppLocale,
  AppLocaleSchema,
} from "@planner/shared/src/i18n/app-locale.ts";
import languageNames from "@planner/shared/src/i18n/locale-names.json";
import { useId } from "react";
import { getTextDirection } from "./get-text-direction.ts";

type LanguageSelectProps = {
  label: string;
  locale: AppLocale;
  disabled?: boolean;
  errorId?: string | undefined;
  onChange: (locale: AppLocale) => void;
};

export function LanguageSelect(props: LanguageSelectProps) {
  const id = useId();

  return (
    <div className="flex w-full max-w-xs flex-col gap-y-2">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className="min-h-11 w-full rounded-panel border border-line bg-panel px-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        value={props.locale}
        disabled={props.disabled}
        aria-describedby={props.errorId}
        onChange={(event) =>
          props.onChange(AppLocaleSchema.parse(event.currentTarget.value))
        }
      >
        {Object.entries(languageNames).map(([locale, name]) => (
          <option
            key={locale}
            value={locale}
            lang={locale}
            dir={getTextDirection(locale)}
          >
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
