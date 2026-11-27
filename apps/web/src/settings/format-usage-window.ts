import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

export function formatUsageWindow(options: {
  label: string;
  locale: AppLocale;
  t: MessageTranslator;
}) {
  const { label, locale, t } = options;
  if (label === "Session") return t("settings.usageSession");
  if (label === "Weekly") return t("settings.usageWeekly");
  const [, model] = /^Weekly · (.+)$/.exec(label) ?? [];
  if (model) return `${t("settings.usageWeekly")} · ${model}`;
  const [, amount, unit] = /^(\d+)-(hour|minute)$/.exec(label) ?? [];
  if (amount === undefined || unit === undefined) return label;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "long",
  }).format(Number(amount));
}
