export function parseDecimal(text: string) {
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized))
    return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
