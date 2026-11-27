# B12 — Use the app from other devices on the user's tailnet

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 2 (the daemon accepts WebSocket and HTTP only from the web app's origin; the Host check; the token rule for clients with no Origin).

## Facts

- This Mac on the tailnet: `roomkit-host.example-tailnet.ts.net` (Tailscale is up; MagicDNS on). The user's iPad is on the same tailnet.
- `tailscale serve` already publishes another app on HTTPS port 443 (`/` → `http://127.0.0.1:4800`). Do not change or remove it.
- The planner gets its own HTTPS port, 8443, tailnet only (`tailscale serve`, never `funnel`): `/` → `http://127.0.0.1:3210` (web), `/daemon` → `http://127.0.0.1:4820` (daemon HTTP and WebSocket). Confirm whether `tailscale serve` strips the `/daemon` mount prefix before forwarding, and handle what it does.
- Today the web app hard-codes the daemon at `127.0.0.1:${NEXT_PUBLIC_PLANNER_PORT}` (`apps/web/src/planner/planner-provider.tsx`, `apps/web/src/daemon-http/get-daemon-url.ts`).

## Scope (`apps/web/src/` for the daemon address, `packages/daemon/src/config/` and the Origin and Host checks, `scripts/`, `README.md`, `docs/PLAN.md` section 2)

1. **Web:** when the page is served from `localhost` or `127.0.0.1`, keep talking to `127.0.0.1:4820` directly; otherwise use the page's own origin with the `/daemon` prefix (`wss://…/daemon/ws`, `https://…/daemon/...`). One function decides; every daemon URL goes through it.
2. **Daemon:** allowed origins and allowed hosts come from config: `PLANNER_WEB_ORIGIN` (already a list) plus a new `PLANNER_ALLOWED_HOSTS`, so `https://roomkit-host.example-tailnet.ts.net:8443` and its host are accepted, and every other origin and host is still refused. The daemon keeps listening on `127.0.0.1` only; Tailscale reaches it locally.
3. **`scripts/tailnet-serve.sh`:** sets up the 8443 serve config idempotently (prints the URL), and `scripts/tailnet-serve.sh off` removes only the planner's entries. README section "Use from other devices" with the two commands and the env values to start the daemon with.
4. Record in PLAN section 2: tailnet-only access, its origin and host, and that Funnel is never used.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Never run `tailscale funnel`. Do not stop or restart the user's running app (daemon on 4820, web on 3210); test on free ports.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. A test: the daemon started with a tailnet origin and host accepts a WebSocket and an HTTP request carrying them, and refuses a foreign origin and a foreign host.
3. A unit test for the web URL function (local page → `127.0.0.1:4820`; tailnet page → same-origin `/daemon`).
4. The orchestrator runs `scripts/tailnet-serve.sh` and opens the tailnet URL to check the editor connects.

## Decision: tailnet HTTP auth (orchestrator)

Chromium omits `Origin` on same-origin GET requests, so over the tailnet (page and `/daemon` share one origin) the daemon must not require `Origin`. For a request whose Host is an allowed tailnet host, accept it when both hold:
1. `Tailscale-User-Login` equals a configured login (`PLANNER_TAILNET_LOGINS`, a list; the user is `planner@example.com`; read the exact form `tailscale serve` sends). The daemon listens on 127.0.0.1 only, so only a local process could forge it.
2. `Origin` is the allowed tailnet origin, or `Sec-Fetch-Site` is `same-origin` (web pages cannot forge it).
Refuse everything else on the tailnet host (no Tailscale login header, a wrong login, cross-site). Local behaviour (`localhost:3210`, token for no-Origin clients) is unchanged. WebSocket upgrades follow the same rule. Record it in PLAN section 2. Tests: accepted same-origin GET with the login header; refused without it, with a wrong login, with `Sec-Fetch-Site: cross-site`.
