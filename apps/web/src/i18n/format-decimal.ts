export function formatDecimal(options: {
  value: number;
  locale?: string | undefined;
  digits?: number;
}) {
  const digits = options.digits ?? 2;
  return new Intl.NumberFormat(options.locale ?? "en", {
    useGrouping: false,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(options.value);
}
