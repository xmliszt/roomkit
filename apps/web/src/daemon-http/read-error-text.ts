/** Return the daemon's plain-text error for a failed `response`, or its status when the body is empty. */
export async function readErrorText(response: Response) {
  const text = (await response.text().catch(() => "")).trim();
  return text === "" ? `HTTP ${response.status}` : text;
}
