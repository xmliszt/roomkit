# A6 — Charging port type picker

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 4 (charging port family) and B4's catalog in `packages/shared/src/catalog/` (`CHARGING_PORT_TYPES`, thumbnails); `docs/DESIGN.md` sections 4 and 7.

## Scope (`apps/web`, plus one catalog route in `packages/daemon`)

1. **Inspector:** for a charging port, a "type" row that opens a small picker with each type's thumbnail and label; choosing one sends the single `item.update` B4 defined (model and `sizeM`; placement unchanged). Undo restores the previous type.
2. **Add popover:** the catalog lists the charging port once; adding uses the last type picked in this project, Type G by default.
3. Thumbnails: add one read-only daemon route, `GET` under B1's route prefix `/catalog/:assetId/thumb.png`, serving the checked-in catalog thumbnail for a validated catalog asset id, with B1's Host check and token rule. Put it in a new file in `packages/daemon` plus its one registration line and a test; touch nothing else in `packages/` (B5 is editing the daemon). The web app loads it the way A3 loads asset files.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`. Another Codex agent (B5) edits the chat composer in `apps/web/src/editor/chat*` and `composer*`; do not edit those files.

## Gate

1. `pnpm check` and `pnpm test:e2e` pass.
2. A Playwright test: add a charging port, switch it to Type A/B in the inspector, check `alongM` and `heightM` are unchanged and the asset changed in the daemon's scene, undo, check Type G is back; reload and check the state persists.
3. The picker's thumbnails load (`naturalWidth > 0` in the test).
4. A screenshot of the picker open, saved outside the repo.
