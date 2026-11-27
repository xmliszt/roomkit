export function getDaemonUrl(options: {
  path: string;
  protocol?: "http" | "ws";
}) {
  const location = typeof window === "undefined" ? undefined : window.location;
  const isLocal =
    location === undefined ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  const url = new URL(
    isLocal
      ? `http://127.0.0.1:${process.env.NEXT_PUBLIC_PLANNER_PORT ?? "4820"}${options.path}`
      : `${location.origin}/daemon${options.path}`,
  );
  if (options.protocol === "ws")
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
