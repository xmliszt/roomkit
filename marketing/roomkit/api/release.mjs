import { latestReleaseUrl, parseRelease } from "../release-source.mjs";

const routes = {
  "/appcast.xml": "appcast",
  "/release.json": "version",
  "/downloads/Roomkit.dmg": "dmg",
  "/downloads/Roomkit.dmg.sha256": "checksum",
};

export default {
  async fetch(request) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD");
      return new Response(null, { status: 405, headers });
    }
    const url = new URL(request.url);
    const asset = routes[url.pathname] ?? url.searchParams.get("asset");
    if (!["appcast", "checksum", "dmg", "version"].includes(asset)) {
      return new Response(null, { status: 404, headers });
    }
    try {
      const result = await fetch(latestReleaseUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok) throw new Error("Release metadata unavailable.");
      const release = parseRelease(await result.json());
      if (asset === "dmg" || asset === "checksum") {
        headers.set("Location", release[asset]);
        return new Response(null, { status: 307, headers });
      }
      const appcast = asset === "appcast";
      headers.set(
        "Content-Type",
        appcast
          ? "application/rss+xml; charset=utf-8"
          : "application/json; charset=utf-8",
      );
      const body = appcast
        ? release.appcast
        : JSON.stringify({
            version: release.version,
            dmg: release.dmg,
            checksum: release.checksum,
          });
      return new Response(request.method === "HEAD" ? null : body, { headers });
    } catch {
      headers.set("Retry-After", "60");
      return new Response(null, { status: 503, headers });
    }
  },
};
