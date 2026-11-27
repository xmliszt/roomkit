# A5 — Chat panel, Jobs, Log and Settings UI (closes M2 in the browser)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (chat blocks and the chat events signed off in B1, jobs), 5.3, 6 (Settings) and 8 (M2); `docs/DESIGN.md` sections 4 (chat panel, composer, keys, other pages), 7, 8 (chat, jobs, log: every block kind) and 9 (iso figures for Settings); the mock `docs/mock/editor-mock.html` (its chat thread is the reference look). The daemon side is merged: B2 (agent runtime, designer chat over WS, usage windows) and B3 (preflight, install jobs, `job.log`, link previews).

## Scope (`apps/web` only)

1. **Chat panel** (Chat tab): renders every block kind in DESIGN 8 from the WS chat events, streaming text as it arrives, a `tool` line that expands, `diff` blocks with a working undo, `notice` blocks with a Settings link, `choice` blocks that answer, `image` thumbnails with a lightbox. The composer sends text. Photo attachments in chat, and showing uploaded photos and link preview images, need daemon contracts that do not exist yet (B5): keep the attach UI, but while photos are attached show a short note that sending photos comes next and send the text only; render `image` and `link` blocks from data URLs or without the image when no route exists. The agent role shows as an 11 px label.
2. **Jobs tab** and the job strip: one row per job with stage marks and progress; click a job strip segment to open it. **Log tab:** the raw event stream with time, filter by job and role.
3. **Settings page** `/settings`: Agents (per CLI: path, version, sign-in, plan, usage windows as thin bars with reset time; model per role), Blender (detected path and version; Install and Pick path), Python runtime (env state; each model's weights with size and state; download, delete), Connections (placeholder rows). Install and download jobs stream their log. The row pattern and iso figures from DESIGN 9 (`iso-glow` skill), each lit only by real state.
4. **Command palette** (`⌘K`, the `commands` button): today the button does nothing. Build a small palette that lists the actions the editor already has (tools, add charging port, snapshot, export, import, blueprint view, open chat, settings), keyboard-driven.
5. **Favicon:** add one (the app requests `/favicon.ico` and gets 404).

Out of scope: the charging port type picker (after B4), generation animations (M3). Do not edit `packages/`; if a message you need is missing, stop and report.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Use the `interface-craft` critique approach on your screenshots (look at them, list what looks off against DESIGN and the mock, fix it).

## Gate

1. `pnpm check` passes; all earlier gates and e2e tests pass.
2. Playwright with the fake CLIs (free ports, temp folders): in the editor, type "move the charging port 0.5 m left" in the composer; the chat shows the designer's streamed text and a `tool` line; the port moves 0.5 m along its wall; the `diff` block appears and its undo restores the port. Open `/settings`: both CLIs show sign-in state and usage windows from the fake data; a fake Blender install job streams log lines and ends with Blender detected. `⌘K` opens the palette and running "snapshot" saves a PNG.
3. Screenshots (chat with several block kinds, Jobs, Log, Settings, palette) saved outside the repo, with your critique notes and fixes listed in your final message.
