export function reconnectDelay(attempt: number) {
  return Math.min(10_000, 500 * 2 ** Math.min(Math.max(0, attempt), 5));
}
