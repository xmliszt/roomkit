import { z } from "zod";
import localeNames from "./locale-names.json" with { type: "json" };

export const AppLocaleSchema = z.enum(
  Object.keys(localeNames).filter(
    (locale): locale is keyof typeof localeNames =>
      Object.hasOwn(localeNames, locale),
  ),
);

export type AppLocale = z.infer<typeof AppLocaleSchema>;
