# S5 — Usage endpoints: result

Run on 2026-11-22 with `claude` 2.1.330 and `codex-cli` 0.165.0, both signed in. Script: `node scripts/spikes/s5-usage-endpoints.ts` (Node 24.22, built-ins only, no flags).

## Result

**Pass.** PLAN.md section 7 row S5 asks for "windows returned for both". Both endpoints answered HTTP 200 to Studio's exact requests, and each returned at least one usage window with a percentage and a reset time.

| | `claude` | `codex` |
|---|---|---|
| Path | `~/.local/bin/claude` | `~/.local/bin/codex` |
| Version | 2.1.330 (Claude Code) | codex-cli 0.165.0 |
| Sign-in | signed in (claude.ai) | signed in (ChatGPT) |
| Plan | `team` | `self_serve_business_prolite` |
| Endpoint | `GET https://api.anthropic.com/api/oauth/usage` | `GET https://chatgpt.com/backend-api/wham/usage` |
| Answered with | Studio's headers, `User-Agent: claude-code/2.1.0` | Studio's headers, `User-Agent: codex-cli` |
| Windows | 5-hour 49%, Weekly 62% | Weekly 17% (604800 s window) |
| Reset times | after now and within one window length | after now and within one window length |

The gate also passes when a CLI is missing or signed out. With `PLANNER_CLAUDE_BIN` and `PLANNER_CODEX_BIN` set to paths that do not exist, the script prints `unavailable: not installed` for each and exits 0. With `CLAUDE_CONFIG_DIR` and `CODEX_HOME` set to an empty folder, it prints `unavailable: not signed in` for each, makes no request, and exits 0.

## What answered

- **Detection.** `--version`, `claude auth status --json` (`loggedIn: true`) and `codex login status` (`Logged in using ChatGPT`) behave as Studio expects. `codex exec --help` still lists `--ignore-user-config` and `--dangerously-bypass-hook-trust`.
- **Claude credentials.** The script's `credentials` row showed: read from the macOS keychain item `Claude Code-credentials`, `scopes` include `user:profile`, access token not past its expiry time. `claudeAiOauth.subscriptionType` is still there (`team`).
- **Codex credentials.** The `credentials` row showed: read from `~/.codex/auth.json`, `tokens.access_token` present, `tokens.account_id` present.
- **Claude usage.** `five_hour` and `seven_day` are objects with `utilization` (a 0–100 number) and `resets_at` (a string that parses as a date; `limits[].resets_at` printed raw is ISO 8601 with a `+00:00` offset). The script's checks, which accept exactly what Studio's zod schemas accept, pass.
- **Codex usage.** `plan_type` and `rate_limit.primary_window` with `used_percent`, `limit_window_seconds` and `reset_at` (seconds since the epoch). The script's checks, which accept exactly what Studio's zod schemas accept, pass.
- **Units.** Reset times on both endpoints are after now and within one window length, so `reset_at` is still in seconds and `resets_at` still a date string. The Codex window printed `604800 s`, so `limit_window_seconds` is still in seconds.

## What did not answer

- `read-usage-limit.ts` is **not verified by this spike**. It parses the usage-limit text and event that a CLI emits during a turn, and this spike is forbidden from running a turn. M2 should cover it with the fake CLIs and confirm it on the first real limit.
- **A Claude Code session was running on this machine during every run**, so the stored access token was fresh. The script never refreshes a token. On an idle machine the token may be past its expiry time and the endpoint may answer 401 until `claude` next runs; Studio's message for that case ("run claude once to refresh it") still fits.
- Not tested: an API-key sign-in, an expired or refused token (the script never refreshes one), HTTP 429, and Claude credentials read from `.credentials.json` instead of the keychain.

## What changed since Studio's code

Studio's zod schemas drop unknown keys, so none of these break it. They change what the Settings page can show.

**Claude**

1. **A new `limits[]` array carries every limit in one form**: `kind`, `group`, `percent`, `severity`, `resets_at`, `scope`, `is_active`. This run returned three entries: `session` (49%), `weekly_all` (62%) and `weekly_scoped` (54%, `scope.model.display_name` "Fable").
2. **The model-specific weekly limit is only in `limits[]`.** `seven_day_opus` and `seven_day_sonnet` are both `null` on this plan, and the `weekly_scoped` entry has `scope.model.display_name`. Studio's four fixed keys show two windows; the account has three limits.
3. Each window object has new fields: `limit_dollars`, `used_dollars`, `remaining_dollars`, `locked_reason` (all `null` here).
4. New top-level blocks: `extra_usage` and `spend` (overage credits and spend limit), `weekly_scoped_shares[]`, and about 25 other keys that are `null` on this plan.
5. `claude auth status --json` now reports `subscriptionType` and `planTier`. The plan no longer needs the credentials blob; both sources returned `team`.

**Codex**

1. **This plan has one window, and it is weekly.** `primary_window` has a 7-day `limit_window_seconds`; `secondary_window` is `null`. Studio's label comes from `limit_window_seconds`, so it prints "Weekly" correctly. Its fallback labels ("Session" for primary, "Weekly" for secondary) would be wrong if the field were absent.
2. New fields: `rate_limit.allowed`, `rate_limit.limit_reached`, `primary_window.reset_after_seconds`, `rate_limit_reached_type`.
3. New blocks: `spend_control.individual_limit` (with its own `used_percent` and `reset_at`), `credits`, `model_usage`, `rate_limit_reset_credits`, `additional_rate_limits` and `code_review_rate_limit` (both `null` here).
4. The response body includes `email`, `user_id` and `account_id`. Do not log the raw body.

## What M2 should copy as is

- `check-coding-agents.ts`: the detection sequence, with `STUDIO_` renamed to `PLANNER_` and the one fix in the next section.
- `read-coding-agent-usage.ts`: both URLs, all headers (including the old `claude-code/2.1.0` User-Agent, which still works), the keychain-then-file credential read, the `user:profile` scope check, the 8 s timeout, the Codex parsing and `windowLabel`.
- The rule from PLAN.md section 2: show "unavailable" on any failure and never block on these reads.
- `read-usage-limit.ts`: copy unchanged; it is untested here.

## What M2 should change

1. **Proposal, for the chief engineer to decide: read Claude windows from `limits[]` first, and fall back to the four fixed keys when it is absent.** It departs from "copy, do not rewrite". It rests on one response from one `team` account: `percent` matched `utilization` for the two shared windows, and `is_active` was `false` for `session` and `weekly_scoped` and `true` for `weekly_all`; what `is_active` means is unknown, so do not filter on it. Map `kind` to a label (`session` → "5-hour", `weekly_all` → "Weekly", `weekly_scoped` → "Weekly · " + `scope.model.display_name`), `percent` to the bar, `resets_at` to the reset time. This is the only change that affects what the user sees: without it the model-specific weekly limit is missing from Settings.
2. **Split the failure reasons.** Studio reports non-200 and a schema mismatch as one message. Keep them apart (refused sign-in, HTTP 429, other status, changed shape, timeout), as the script does, so a future endpoint change is recognisable from the Settings row.
3. **Read the Claude plan from `claude auth status --json`** (already run for the sign-in check) and keep the credentials value as the fallback.
4. **Never log the Codex response body**, because it carries the account email and ids.
5. **Check `timedOut` before the exit-code test in `check-coding-agents.ts`.** Studio's `exec.ts` returns code 127 for a child it killed on timeout, and the check maps 127 to `not_installed`, so a `--version` that runs past 5 s is reported as "not installed". The script reports "--version timed out".
6. **Open: do not run the detection commands more often than needed.** `--version` and `claude auth status` write `.claude.json`, `backups/` and `tmp/` under the CLI config folder. This is accepted as the same behaviour as Studio.
7. **Open: check the Claude credential read under `CLAUDE_CONFIG_DIR` before copying it as is.** With `CLAUDE_CONFIG_DIR` set, the read skips the keychain and uses `.credentials.json` only. It is unverified whether Claude Code stores such sign-ins under a suffixed keychain item.
8. Optional, not needed for V1: `spend` / `extra_usage` (Claude) and `spend_control` / `credits` (Codex) could feed a spend row later.

## Notes on the script

- It reads the stored OAuth tokens and sends each only to its own provider's endpoint, in a request header. It prints allowlisted fields and the response's key paths with types. Key names are printed as received when they are 1 to 40 lower-case letters and `_`, and as `<key>` otherwise; no other value from a response or a credentials file is printed.
- It never refreshes a token and writes nothing to either CLI's config. It does run `--version` on both CLIs, `claude auth status --json`, `codex exec --help`, `codex login status` and `security find-generic-password`, as Studio does. Requests do not follow redirects. Those commands write their own state: run with `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed at an empty folder, they created `.claude.json`, `backups/` and `tmp/` there. Whether they refresh a stored token was not checked.
- Each run makes one request per endpoint.
