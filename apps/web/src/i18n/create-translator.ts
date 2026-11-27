import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import type { MessageTranslator } from "./message-translator.ts";
import english from "./messages/en.json";

export function createTranslator(options: {
  locale: AppLocale;
  catalog: { [key: string]: string };
}): MessageTranslator {
  const fallback: { [key: string]: string } = english;
  const numbers = new Intl.NumberFormat(options.locale);

  return (key, values) => {
    const message = options.catalog[key] ?? fallback[key] ?? key;
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = values?.[name];
      return typeof value === "number"
        ? numbers.format(value)
        : (value ?? placeholder);
    });
  };
}
