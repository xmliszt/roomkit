import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import english from "./messages/en.json";

export async function loadMessages(locale: AppLocale) {
  if (locale === "en") return english;
  const catalog: { default: { [key: string]: string } } = await import(
    `./messages/${locale}.json`
  );
  return catalog.default;
}
