import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { useId, useState } from "react";
import { LanguageSelect } from "./language-select.tsx";
import { useAppLanguage } from "./use-app-language.ts";

export function SettingsLanguage() {
  const language = useAppLanguage();
  const [failed, setFailed] = useState(false);
  const errorId = useId();

  async function change(locale: AppLocale) {
    setFailed(false);
    setFailed(!(await language.saveLanguage(locale)));
  }

  return (
    <div className="flex flex-col gap-y-2">
      <LanguageSelect
        label={language.t("language.label")}
        locale={language.locale}
        disabled={language.saving}
        onChange={change}
        errorId={failed ? errorId : undefined}
      />
      <div id={errorId} role="alert" className="text-danger empty:hidden">
        {failed ? language.t("language.saveFailed") : null}
      </div>
    </div>
  );
}
