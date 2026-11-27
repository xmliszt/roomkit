# B2 — Agent runtime, planner MCP and the `designer` role

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 ("Copy from Studio", with the S5 changes listed there), 3 (commands, WS protocol, chat events as signed off in B1), 5.3 and 8 (M2). Studio source: `/path/to/studio/packages/daemon/src/` and `test/fake-cli/`.

## Scope (`packages/daemon`, `packages/mcp`, `packages/shared` where the signed-off chat schemas need wiring, `roles/`, `test/fake-cli/`)

1. **Agent runtime,** copied from Studio and renamed `STUDIO_` → `PLANNER_`, not rewritten: `agent/claude-runtime.ts`, `build-codex-args.ts`, `create-process-runtime.ts`, `stream-json.ts`, `decode-codex-event.ts`, `runtime.ts`, `create-agent-runtime.ts`, `hooks.ts`, `hooks/pretooluse.mjs`, `util/scrubbed-env.ts`, `agent/stop-orphan-agents.ts`. Headless turn per process, prompt on stdin, session ids made in advance, inactivity timeout 900 s, SIGTERM then SIGKILL on the process group, one retry in a new session when a resumed session is gone. Always `--strict-mcp-config` (Claude) and `--ignore-user-config` (Codex). At most 2 agent turns at once.
2. **Agent checks and usage:** `check-coding-agents.ts`, `read-coding-agent-usage.ts`, `read-usage-limit.ts`, with every S5 change in PLAN section 2. Usage is a list of windows.
3. **Planner MCP** (`packages/mcp`, stdio JSON-RPC, hand-written, no SDK), copied from Studio's `mcp/main.ts`, `write-mcp-config.ts` (mode 0600), `create-orchestrator-link.ts`. Tools for the `designer` role: `scene_get`, `scene_apply` (runs the same commands through the same reducer path as the UI), `job_status`, `chat_post` (rich blocks only, never plain text). `asset_generate` and `asset_variant` are M3: register them returning a clear "not available until M3" error. Tools filtered per role twice, in `--allowedTools` and inside the server.
4. **`roles/designer.md`.** Short: what the designer does, which tools, that scene changes go through `scene_apply`, that sizes are meters.
5. **Chat over WS** with the event shapes signed off in B1: a user message starts a `designer` turn; streamed text becomes the `text` block; `tool`, `diff` and `notice` blocks are built by the daemon from events (PLAN 3). Every scene change the agent makes yields a `diff` block with undo (the inverse command).
6. **Fake CLIs** (`test/fake-cli/`, copied in M0) wired so tests run whole turns with real event formats and real MCP calls. Add the scenario the gate needs.
7. **Settings data over WS or HTTP** for the Agents section: per CLI path, version, sign-in state, plan, usage windows, model per role (defaults from PLAN 5.3). UI is Track A's.

Out of scope: `apps/web` (Track A builds the chat panel and Settings UI against your events), `asset_generate`, Blender and Python install jobs.

## Gate

1. `pnpm check` passes, `pnpm gate:m0` and `pnpm gate:b1` still pass.
2. `pnpm gate:m2` (free ports, temp `PLANNER_HOME` and `PLANNER_PROJECTS`, fake CLIs only): a project with a charging port; a chat message "move the charging port 0.5 m left" makes the fake `claude` call `scene_apply`; the scene changes by exactly that move, a `diff` block arrives over WS, its undo restores the scene; the same with the fake `codex`; killing a turn mid-run stops its whole process group.
3. A script for the one manual run with the real `claude`, `scripts/m2-real-claude.ts`, that the orchestrator runs by hand once. It must use a temp project and never touch the user's own projects.
