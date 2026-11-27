import { afterEach, expect, test, vi } from "vitest";
import { getDaemonUrl } from "./get-daemon-url.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("uses the loopback daemon for local pages and server rendering", () => {
  vi.stubEnv("NEXT_PUBLIC_PLANNER_PORT", undefined);
  vi.stubGlobal("window", undefined);
  expect(getDaemonUrl({ path: "/health" })).toBe(
    "http://127.0.0.1:4820/health",
  );
  for (const hostname of ["localhost", "127.0.0.1"]) {
    vi.stubGlobal("window", {
      location: { hostname, origin: `http://${hostname}:3210` },
    });
    expect(getDaemonUrl({ path: "/health" })).toBe(
      "http://127.0.0.1:4820/health",
    );
    vi.stubEnv("NEXT_PUBLIC_PLANNER_PORT", "49123");
    expect(getDaemonUrl({ path: "/ws", protocol: "ws" })).toBe(
      "ws://127.0.0.1:49123/ws",
    );
    vi.stubEnv("NEXT_PUBLIC_PLANNER_PORT", undefined);
  }
});

test("uses the page origin and daemon prefix on other devices", () => {
  for (const protocol of ["http", "https"]) {
    const origin = `${protocol}://roomkit-host.example-tailnet.ts.net:8443`;
    vi.stubGlobal("window", { location: new URL(origin) });
    expect(getDaemonUrl({ path: "/photos?size=thumb" })).toBe(
      `${origin}/daemon/photos?size=thumb`,
    );
    expect(getDaemonUrl({ path: "/ws", protocol: "ws" })).toBe(
      `${protocol === "https" ? "wss" : "ws"}://roomkit-host.example-tailnet.ts.net:8443/daemon/ws`,
    );
  }
});
