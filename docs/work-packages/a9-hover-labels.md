# A9 — Object labels on hover, with a show-all toggle

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 4 ("Object labels", just above section 5), sections 6 and 7.

## Scope (`apps/web/src/` only)

1. Object tags in the scene (all stages, ready items included) are hidden by default; a tag shows while its object is hovered and while it is selected.
2. A `labels` toggle button in the top strip, between `blueprint` and `commands`, and the `L` key: on shows every tag. Remember the choice in `localStorage` (try/catch; default off). Add it to the ⌘K palette.
3. Showing and hiding is instant (DESIGN 7: frequent actions have no motion).

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. The user's app is running on ports 3210 and 4820 and is being screen-recorded; test on free ports and do not stop it.

## Gate

1. `pnpm check` and `pnpm test:e2e` pass.
2. Playwright: with three items, no tag is visible; hovering one shows only its tag; selecting shows its tag; `L` shows all three; reload keeps the setting.
3. Screenshots of labels off (one hovered) and labels on, saved outside the repo.
