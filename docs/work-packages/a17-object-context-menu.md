# A17 — Object context menu

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (tokens, type, motion, top strip, inspector, chat composer chips), `docs/PLAN.md` section 3 (commands, `generation.regenerate` from B18, mirroring from A14). Starts after A14 and B18 are merged into `orchestrator`.

## What the user asked for

Right-click an object in the scene to get a simple menu. Selecting an object no longer adds it to the chat composer (already done on `orchestrator`, commit ed5981f); "Send to Chat" in this menu is now the way to quote an object besides the `@` picker.

## Scope (`apps/web/src/editor/`, `docs/DESIGN.md`)

1. **Opening.** Right-click (or two-finger click, or `Shift+F10` / the context-menu key on the selection) on an object selects it and opens the menu at the pointer. A right-button drag still pans the camera; only a press and release that moves under 4 px opens the menu. Right-click on empty floor shows nothing new (no browser menu over the canvas either). `Esc`, a click elsewhere, scroll, or a camera move closes it.
2. **Look.** No outer container: a left-aligned vertical stack of separate rectangular items (square corners, `--bg` fill, 1 px `--line` border, `--ink` text at the body size, shortcut hint right-aligned in `--ink-dim`), 2 px gap between items, positioned at the pointer and kept inside the viewport. Hover and keyboard focus: `--line-strong` border and `--accent-soft` fill. Destructive item (Delete) uses `--danger` text. Enters with the panel-enter motion; none under reduced motion.
3. **Items, in order:**
   - **Edit** — opens the side pane on the Selected tab (the inspector) for this object.
   - **Regenerate…** — replaces the stack with an inline note field in the same style ("What should change? (optional)") and two actions: **Regenerate** (`generation.regenerate {itemId, notes}`; the new model replaces this one when ready, undoable) and **Try another version** (`generation.alternatives`). Hidden for held items, which get **Model this** instead (`generation.start`); disabled while the item's job is queued or generating.
   - **Send to Chat** — adds the object as a chip in the composer and focuses the prompt (opens the composer if chrome is hidden).
   - **Duplicate** `⌘D`, **Duplicate mirrored**, **Mirror** — the existing actions from the inspector (A14).
   - **Lock** / **Unlock**.
   - **Delete** `⌫`.
   Every item calls the same handler the inspector or keyboard uses; do not add a second code path.
4. **Keyboard.** Arrow keys move focus, `Enter` runs, `Esc` closes and returns focus to the canvas. `role="menu"` / `menuitem`, labelled by the object's name.
5. Update DESIGN.md: a "Context menu" paragraph with the above, and the Objects panel row actions wording "quote in chat" → "Send to Chat".

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. Browser tests (in the existing suite): right-click an object opens the menu at the pointer with the items above; a right-drag pans and opens nothing; Edit opens the inspector; Send to Chat adds exactly one chip and selecting another object adds none; Regenerate with a note sends `generation.regenerate` with that note (fake daemon); Duplicate mirrored, Mirror, Lock and Delete work and undo; keyboard-only open, move and run; the menu stays inside a 1440 × 900 viewport when opened near each edge. Save a screenshot of the open menu as evidence.
