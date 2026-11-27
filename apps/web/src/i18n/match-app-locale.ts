import { AppLocaleSchema } from "@planner/shared/src/i18n/app-locale.ts";

export function matchAppLocale(languages: readonly string[]) {
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language);
      const exact = AppLocaleSchema.safeParse(locale.baseName);
      if (exact.success) return exact.data;
      if (locale.language === "zh") {
        return locale.maximize().script === "Hant" ? "zh-Hant" : "zh-Hans";
      }
      if (locale.language === "pt") return "pt-BR";
      const base = AppLocaleSchema.safeParse(locale.language);
      if (base.success) return base.data;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return "en";
}
