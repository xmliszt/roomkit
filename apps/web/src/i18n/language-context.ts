import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { createContext } from "react";
import type { MessageTranslator } from "./message-translator.ts";

export const LanguageContext = createContext<
  | {
      locale: AppLocale;
      t: MessageTranslator;
      saveLanguage: (locale: AppLocale) => Promise<boolean>;
      saving: boolean;
    }
  | undefined
>(undefined);
