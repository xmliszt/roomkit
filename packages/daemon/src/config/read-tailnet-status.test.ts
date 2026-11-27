import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readTailnetStatus } from "./read-tailnet-status.ts";
import { resolveEnvironment } from "./resolve-environment.ts";

const host = "roomkit-host.example-tailnet.ts.net:8443";
const node = {
  BackendState: "Running",
  Self: { DNSName: `${host.split(":")[0]}.` },
};
const serve = {
  TCP: { "8443": { HTTPS: true } },
  Web: {
    [host]: {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:3210" },
        "/daemon": { Proxy: "http://127.0.0.1:4820" },
      },
    },
  },
};

test("reports a URL only when both private HTTPS routes and Roomkit's allowlist are configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "roomkit-serve-status-"));
  const configured = {
    PLANNER_ALLOWED_HOSTS: host,
    PLANNER_WEB_ORIGIN: `http://localhost:3210,https://${host}`,
    PLANNER_TAILNET_LOGINS: "planner@example.com",
  };
  const environment = resolveEnvironment(configured);

  try {
    expect(
      await readTailnetStatus({ env: { PATH: root }, environment }),
    ).toEqual({ kind: "cli-missing" });
    await writeFile(
      join(root, "tailscale"),
      `#!/bin/sh
if [ "$*" = 'status --json --peers=false' ]; then
  printf '%s' "$NODE_STATUS"
elif [ "$*" = 'serve status --json' ]; then
  printf '%s' "$SERVE_STATUS"
else
  exit 1
fi
`,
      { mode: 0o700 },
    );
    const env = {
      PATH: root,
      NODE_STATUS: JSON.stringify(node),
      SERVE_STATUS: JSON.stringify(serve),
    };
    expect(await readTailnetStatus({ env, environment })).toEqual({
      kind: "ready",
      host,
    });
    expect(
      await readTailnetStatus({
        env,
        environment: resolveEnvironment({
          ...configured,
          PLANNER_TAILNET_LOGINS: "",
        }),
      }),
    ).toEqual({ kind: "roomkit-not-configured", host });
    expect(
      await readTailnetStatus({
        env: {
          ...env,
          SERVE_STATUS: JSON.stringify({
            ...serve,
            AllowFunnel: { [host]: true },
          }),
        },
        environment,
      }),
    ).toEqual({ kind: "public", host });
    expect(
      await readTailnetStatus({
        env: { ...env, SERVE_STATUS: "" },
        environment,
      }),
    ).toEqual({ kind: "serve-not-configured", host });
    expect(
      await readTailnetStatus({
        env: {
          ...env,
          NODE_STATUS: JSON.stringify({ BackendState: "Stopped", Self: null }),
        },
        environment,
      }),
    ).toEqual({ kind: "disconnected" });
    expect(
      await readTailnetStatus({
        env: {
          ...env,
          NODE_STATUS: JSON.stringify({ BackendState: "Running", Self: {} }),
        },
        environment,
      }),
    ).toEqual({ kind: "needs-dns" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
