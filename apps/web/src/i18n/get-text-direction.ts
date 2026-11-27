const rightToLeftScripts = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

export function getTextDirection(locale: string) {
  const script = new Intl.Locale(locale).maximize().script;
  return script && rightToLeftScripts.has(script) ? "rtl" : "ltr";
}
