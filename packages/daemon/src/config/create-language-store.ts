import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import {
  type LanguagePreference,
  LanguagePreferenceSchema,
} from "@planner/shared/src/i18n/language-preference.ts";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import { writeJson } from "../util/write-json.ts";

const english = { kind: "selected", locale: "en" } satisfies LanguagePreference;

export function createLanguageStore(options: {
  plannerHome: string;
  onReadError?: (error: unknown) => void;
}) {
  const path = join(options.plannerHome, "language.json");
  const initialPreference: LanguagePreference = existsSync(
    join(options.plannerHome, "config.json"),
  )
    ? english
    : { kind: "pending" };
  let lastPreference = initialPreference;

  if (initialPreference.kind === "pending" && !existsSync(path)) {
    mkdirSync(options.plannerHome, { recursive: true });
    writeJson({ path, value: initialPreference });
  }

  return {
    get(): LanguagePreference {
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          if (!isMissingPathError(error)) options.onReadError?.(error);
          return lastPreference;
        }
      }
      const saved = LanguagePreferenceSchema.safeParse(value);
      if (saved.success) lastPreference = saved.data;
      else if (lastPreference.kind === "pending") lastPreference = english;
      return lastPreference;
    },

    set(locale: AppLocale) {
      const preference = {
        kind: "selected",
        locale,
      } satisfies LanguagePreference;
      writeJson({ path, value: preference });
      lastPreference = preference;
      return preference;
    },
  };
}
