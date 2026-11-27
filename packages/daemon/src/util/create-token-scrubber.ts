export function createTokenScrubber(env: NodeJS.ProcessEnv) {
  const values = Object.entries(env)
    .filter(([key, value]) => /(?:TOKEN|SECRET|PASSWORD)$/.test(key) && value)
    .map(([, value]) => value)
    .filter((value): value is string => value !== undefined)
    .toSorted((a, b) => b.length - a.length);
  return (text: string) =>
    values.reduce(
      (result, value) => result.replaceAll(value, "[redacted]"),
      text,
    );
}
