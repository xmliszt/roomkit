const unspacedLanguages = ["zh", "ja", "th", "lo", "km", "my"];

/** Return `""` for a BCP 47 `lang` whose script is written without spaces between words, and `" "` otherwise. */
export function getWordSeparator(lang: string) {
  const language = lang.toLowerCase().split("-").at(0) ?? "";
  return unspacedLanguages.includes(language) ? "" : " ";
}
