# A12 — Objects panel (the project catalog)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 4 "Objects panel" (the source of truth for layout and actions), PLAN 5.2 step 9; B16's `item.sources` and crop route; A17's shared editor actions and `useGenerationActions`; F2's surface work for the label style. Starts after B16 merges.

## What the user asked for

"An object list where we can find the objects identified in the room, their in-progress or completed model preview, and their original photo references; in that view we can also select and configure objects, delete, quote and tweak their design via the agent; a one-stop centre for the objects used in the room."

Clarified by the user: "the catalog contains every single object we have in this project; for each object we can quickly configure it, open advanced settings, interact with it to inspect, place it into the scene, edit, delete, duplicate, steer (regenerate) it to become something else. The same catalog is used by the + button so the user can select an item to place in the room."

So the panel lists the project's object library (B16 `objects.library`), not only the items in the room: every model the project has, placed or not (kept alternatives, models whose item was deleted, variants), plus the built-in charging ports. Each entry shows how many times it is in the room.

## Scope (`apps/web/src/`, `docs/DESIGN.md`)

Orchestrator split: A12 builds the Objects panel (rows, states, source crops, inline fields, Place in room, actions, filters and Hidden) and the shared `apps/web/src/objects/use-objects-library.ts` hook. A12b builds the large orbit/zoom Inspect preview and the `+` picker after A12 merges. The preview and picker requirements below belong to A12b.

Library additions to the DESIGN description below:
- **Inspect:** expanding an entry shows a larger preview the user can drag to orbit and scroll to zoom (one shared preview renderer, as A16 does for chat).
- **Place:** "place in room" adds a new item using that model at the centre of the view on the floor (or on the nearest wall for wall-mounted models), selected, then draggable; undoable. For an entry already in the room, selecting its in-room row selects that item.
- **Steer:** regenerate with notes (B18), variant (A8/B10) and try another version are available only for entries in the room, through the existing item-based commands. Unplaced entries offer Inspect (A12b), Place in room and Remove from catalog only. No contract change is needed.
- **Delete:** for an entry in the room, delete removes the item (undoable); "remove from catalog" on an unused entry calls `objects.archive` (with an undo toast calling `objects.restore`).
- **The `+` button** (Add tool) opens the same catalog as a picker: search, the built-in ports first under "Built-in", then the project's models; choosing one places it as above. "From photo", "from prompt" and "variant of selection" stay as entries at the top of the picker.

Archived models appear under a Hidden filter with Restore, using `objects.archived` and `objects.restore`.

The rest, as DESIGN describes:

Build the panel as DESIGN describes: tab `Objects` (key `O`) beside Chat, Jobs and Log; one row per object with preview (turntable thumbnail when ready, dashed box with progress while queued or generating, "model this" when held), name, size, status; expanding a row shows the source photo crops from `item.sources` (each opens full size with its box drawn) and the inspector's size, placement and colour fields inline; selecting a row selects and frames the object, and selecting in the scene highlights its row; row actions reuse the existing handlers (model this, cancel, retry, regenerate with notes, try another version, variant, Send to Chat, duplicate, mirror, delete); filter all / needs attention (failed or held) and search by name. Every action goes through the same handler as the context menu and inspector. No ids are shown anywhere.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass. Browser tests (fixtures): the panel lists every item with the right preview state; expanding an inventoried item shows its crops and opens one full size with its box; row select frames the object and scene select highlights the row; each row action calls the same command as the context menu; filter and search narrow the list; a 30-object room scrolls smoothly (no more than 2 WebGL contexts, reusing A16's shared preview renderer for turntables); an unplaced model appears in the library and "place in room" adds it at the view centre with one undo; the `+` picker lists the built-in ports and the project's models and places the chosen one; "remove from catalog" on an unused entry hides it and undo restores it; the inspect preview orbits on drag.

For the split A12 gate, defer the `+` picker and orbit/zoom preview browser checks to A12b. Verify Hidden lists archived models and Restore returns them to the library. Unplaced entries must not offer steering actions.
