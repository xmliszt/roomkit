import { useContext } from "react";
import { LanguageContext } from "./language-context.ts";

export function useAppLanguage() {
  const language = useContext(LanguageContext);
  if (!language) throw new Error("useAppLanguage needs a LanguageProvider");
  return language;
}
