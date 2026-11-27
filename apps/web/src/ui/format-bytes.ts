export function formatBytes(options: { bytes: number; locale?: string }) {
  const { bytes, locale = "en" } = options;
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  const decimal = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (bytes < 1024 ** 2) return `${decimal.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${decimal.format(bytes / 1024 ** 2)} MB`;
  return `${decimal.format(bytes / 1024 ** 3)} GB`;
}
