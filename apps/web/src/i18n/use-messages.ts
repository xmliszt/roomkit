import { useContext } from "react";
import { createTranslator } from "./create-translator.ts";
import { LanguageContext } from "./language-context.ts";

const english = createTranslator({ locale: "en", catalog: {} });

export function useMessages() {
  return useContext(LanguageContext)?.t ?? english;
}
