# B8 — Inventory fixes from the first real run

Read `docs/work-packages/README.md` first. Spec: `docs/work-packages/b7-inventory.md` and PLAN section 3's inventory contracts; `roles/surveyor.md`; `python/workers/measure.py`; `docs/spikes/test-data.md`.

The inventory regression covers floating objects, room bounds, and measured dimensions with synthetic inputs.

1. **Floating floor items.** The sofa, TV console, fridge and others measured 7–10 cm above the floor (`elevationM` 0.07–0.10). A floor item rests on the floor (`elevationM` 0) unless its bottom sits on another measured item (a TV on a console, a lamp on a table). Find why `measure.py` lifts them (the lowest points of a mask are often occluded or mixed with the floor) and fix it; snap to 0 when no supporting item is under it.
2. **Objects outside the room.** The surveyor listed a balcony table and chairs seen through the glass door and a washing machine in another room. `roles/surveyor.md`: list only objects inside this room, not ones seen through glass or doorways. In code: drop an object whose measured footprint centre lies outside the fitted walls, with a chat note naming it. Doors and windows stay as wall items (PLAN 1).
3. **Scoring in the real gate.** Match objects by aliases (desk ~ table ~ dining table ~ work table), and treat a piece within 0.3 m of two walls as touching both (the fridge stands in a corner).
4. Also in `roles/surveyor.md`: name objects by what they are, briefly (the gate and the user read the names); the desk can be "Desk (oval, fluted legs)".

## Scope

`python/workers/measure.py` and `python/tests/`, `roles/surveyor.md`, `packages/daemon` (inventory application only), `scripts/b7-real-inventory.ts`, `scripts/gate-b7.ts`.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` and `uv run --project python pytest python/tests` pass.
2. The orchestrator reruns `scripts/b7-real-inventory.ts`; it must pass: 7 of 7 found, the four measured pieces within 15%, every floor item that stands on the floor at `elevationM` 0, no object outside the room.
