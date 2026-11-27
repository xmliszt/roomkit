import { useContext } from "react";
import { LanguageContext } from "./language-context.ts";

export function useLocale() {
  return useContext(LanguageContext)?.locale ?? "en";
}
