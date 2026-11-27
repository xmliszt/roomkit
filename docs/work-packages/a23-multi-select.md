# A23 — Select several objects and edit them together (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (inspector, Objects panel, context menu, shortcuts, colour adjust), `docs/PLAN.md` (commands, undo). The user asked for this on 2026-11-24 ("multi-select objects to bulk-edit like colorization"). Web only: build bulk edits from the existing `item.update` / `item.duplicate` / `item.remove` commands, grouped into one undo step the way "Apply to all walls" already groups surface changes (find that code and reuse it). No new command, schema, daemon or MCP change; if you think one is needed, stop and ask the orchestrator.

A22 (switchable light sources) runs in parallel and also edits the inspector, the context menu and `editor-shell.tsx`. Merge `orchestrator` often; once A22 merges, include its light on/off in the bulk actions.

## Scope

1. **Selection model.** Replace the single selected item with an ordered set (last clicked = primary). `⇧`-click and `⌘`-click in the 3D view and in the Objects panel add or remove an item; a plain click selects one; `⌘A` selects all items in the room (not while typing); `Esc` clears. Every selected item shows its selection outline; size labels and drag handles stay on the primary only. Surfaces keep their own single selection, and selecting a surface clears the item set.
2. **Group move and rotate.** Dragging any selected item moves the whole set by the same offset (each floor item stays on the floor, wall items stay on their wall or are left in place if they are on another wall; say which in DESIGN). Arrow-key nudge moves the set. Rotate tool on a set rotates each item about its own centre. Locked items in the set do not move.
3. **Inspector with several selected** ("3 selected", names listed, max 5 then "+N more"):
   - Colour: original / colorize / shift with the same controls; a change applies the same `colorAdjust` to every selected item, previews live, and commits as one undo step.
   - Lock or unlock all, mirror all, duplicate all (one undo), delete all (one undo).
   - Fields that differ across the set show "mixed" and stay empty until edited; size and placement fields are hidden for a multi-selection.
4. **Context menu** on a selected item when several are selected: the bulk actions above; single-item actions (regenerate, try another version, edit, Send to Chat) are hidden or apply to the primary only, labelled so.
5. **Send to Chat** with several selected quotes every selected item into the composer (the chat already supports object refs).
6. **Docs:** DESIGN (selection, inspector multi-state, context menu, shortcuts and shortcut sheet).

## Gate

`pnpm check`, all gate scripts, and your new and directly affected specs only (selection, inspector, context menu, objects panel, colorize); the user asked to skip the full e2e. Tests: reducer-level grouping (one undo restores every item), selection set logic (add, remove, primary, clear), and an e2e that ⇧-clicks three items, colorizes them blue, checks all three render blue, undoes once and checks all three are back. Screenshot into `docs/work-packages/evidence/a23-*.png`.
