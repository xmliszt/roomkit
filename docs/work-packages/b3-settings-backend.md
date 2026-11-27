# B3 — Settings backend: preflight, install jobs, M2 follow-ups

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 (state on disk), 6 (Settings), the "M2 follow-ups" paragraph in section 8, and `docs/spikes/s0-python-env.md`, `docs/spikes/s4-blender-headless.md`.

## Scope (`packages/daemon`, `packages/shared` for job and settings schemas)

1. **Preflight.** One daemon check that reports what is present and missing: `claude` and `codex` (from B2), Blender (path, version; the cask installs 5.3.0 at `/Applications/Blender.app`, wrapper `/opt/homebrew/bin/blender`; `BLENDER` env or `config.blenderPath` overrides), `uv` (`/opt/homebrew/bin/uv`), the Python 3.13 env under `PLANNER_HOME/python/`, and each model's weights under `PLANNER_HOME/python/weights/<model>/` with size and state. Each pipeline step that needs something missing names it instead of failing (PLAN 6).
2. **Install jobs,** each a daemon job with a streamed log over WS and a preflight rerun at the end: install `uv` and Blender with the native Homebrew (`/opt/homebrew/bin/brew`, never the one first in PATH; PLAN section 0 says why); create the Python env from the repo's `python/pyproject.toml` and `uv.lock` into `PLANNER_HOME/python/`; download one model's weights, resumable, with progress; delete one model's weights. Add the `install` job kind (PLAN 3 says job kinds grow per milestone; bring the schema to the advisor first). Models listed in a registry file, not hard-coded per screen; the registry holds only what PLAN section 7 has chosen so far (MapAnything, SAM 2.1, SAM 3 MLX); spikes add the rest.
3. **Pick a path** for Blender (validate it runs `--version`).
4. **M2 follow-ups** from PLAN 8: link titles and OG images fetched by the daemon for `link` blocks (with a timeout, size limit, no redirects to private addresses); a missing CLI gives a `notice` block linking to Settings; carry recent chat history into a new session after a CLI switch or lost session; a test for `stopOrphanAgents`.

Out of scope: `apps/web` (Track A builds the Settings page against your messages). Tests never run real installs: use fake `brew`, `uv` and download servers.

## Gate

1. `pnpm check` passes; `gate:m0`, `gate:b1`, `gate:m2` still pass.
2. `pnpm gate:b3` (fakes only, temp `PLANNER_HOME`): preflight reports a missing Blender and Python env; the install jobs run against fake `brew` and `uv`, stream log lines over WS, and preflight then reports both present; a weights download against a local fake server resumes after a dropped connection and reports progress; deleting the weights updates preflight; a `link` block gets its title from a local fake page.
