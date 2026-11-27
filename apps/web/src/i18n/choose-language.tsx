import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { type FormEvent, useId, useState } from "react";
import { PageColumn } from "../pages-ui/page-column.tsx";
import { RowButton } from "../pages-ui/row-button.tsx";
import { LanguageSelect } from "./language-select.tsx";
import { useAppLanguage } from "./use-app-language.ts";

type ChooseLanguageProps = { suggested: AppLocale };

export function ChooseLanguage(props: ChooseLanguageProps) {
  const language = useAppLanguage();
  const [draft, setDraft] = useState(props.suggested);
  const [failed, setFailed] = useState(false);
  const errorId = useId();

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(!(await language.saveLanguage(draft)));
  }

  return (
    <PageColumn title={language.t("language.choose")}>
      <form onSubmit={confirm} className="flex flex-col items-start gap-y-4">
        <LanguageSelect
          label={language.t("language.label")}
          locale={draft}
          onChange={setDraft}
          disabled={language.saving}
          errorId={failed ? errorId : undefined}
        />
        <RowButton type="submit" disabled={language.saving}>
          {language.t("language.continue")}
        </RowButton>
        <div id={errorId} role="alert" className="text-danger empty:hidden">
          {failed ? language.t("language.saveFailed") : null}
        </div>
      </form>
    </PageColumn>
  );
}
