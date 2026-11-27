# A25 — Rename to Roomkit, social preview (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (tokens, type, hairline paper look, settings), `docs/PLAN.md`. The user asked for this on 2026-11-25 (relayed by the chief engineer session). Web, roles and docs only; no daemon contract or schema change.

## Scope

1. **Rename "Interior Planner" to "Roomkit"** everywhere the user can see it: page titles and the browser tab, the top strip, empty states, settings, chat, agent role prompts that name the product (`roles/*.md`), README, `docs/PLAN.md` and `docs/DESIGN.md` headings, package display names. Keep internal paths and env vars (`~/.interior-planner`, `~/InteriorPlanner`, `PLANNER_HOME`, `PLANNER_PROJECTS`, package scopes like `@planner/*`, the `.iplan` extension): the user's real project lives in `~/InteriorPlanner/projects/`. List every internal name you kept in your final card and in PLAN.
2. **Tagline** "Make a room that feels right." on the start screen and in page metadata.
3. **Social preview.** Use the web app's public image at `/og-1200x630.png` as the Open Graph and Twitter image (1200×630, `summary_large_image`), title "Roomkit", description = the tagline. The user approved that image; do not redraw it.
4. **Settings page:** remove the "Connections" and "About" sections.
5. Hosted 3D generation and voice input rows go away with Connections. Remove any link elsewhere in the app that points at those rows (settings anchors from chat notices, command palette entries); keep what those features need to work.
6. **Docs:** DESIGN (name, tagline, metadata), PLAN (name, kept internal names).

## Gate

Run the Roomkit identity and social metadata browser test.
