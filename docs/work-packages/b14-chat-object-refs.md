# B14 — Point at objects in chat; a reserved agent slot for chat

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (chat contracts incl. B5's `chat.send`), 5 (at most 2 agent turns), 5.3; `docs/DESIGN.md` sections 4 (composer) and 8 (chat blocks).

## What the user asked for

To "quote" an existing object in chat so the designer acts on exactly that object (for example "fix the model of this coffee table").

## Scope (`packages/shared`, `packages/daemon`, `packages/mcp`, `roles/designer.md`, and in `apps/web/src/` the composer, chat thread and the shell's chat send; A10 is editing camera files in `apps/web`, so stay out of the scene camera code)

1. **Object references in messages.** `chat.send` gains optional `itemIds` (1–10, items of this project). The user message stores one `item` reference per object (name, item id, thumbnail when the item has an asset) so the thread shows them as chips. The designer turn receives the ids and names; `roles/designer.md` says to act on referenced items by id.
2. **Composer:**
   - With an object selected, the composer shows a chip for it (`◻ Coffee table ×`); it is sent with the message unless removed.
   - Typing `@` opens a keyboard-navigable list of the room's objects (filter as you type); choosing one inserts a chip. Several chips allowed.
   - Chips in sent messages: hovering one outlines the object in the scene; clicking selects it.
3. **Reserved chat slot** (decided): generation (`modeler`) turns use at most 2 slots; 1 more slot is reserved for designer and surveyor turns, so the total is 3 and a chat reply never waits behind model jobs. No pausing of running modeler turns.

4. **Cancel queued jobs** (the user's request): `job.cancel {projectId, jobId}` for any job still `queued` (generation, generation-alternative, surface, inventory, reconstruction). A cancelled generation job returns its item to held (the pending box stays; "model this" can start it again); other kinds end as `cancelled`. A job already running is refused with a clear error. Web: a cancel action on queued rows in the Jobs tab, on the inspector of an item whose job is queued, and on hover in the job strip. `apps/web/src/` files for the Jobs tab, inspector actions and job strip are in scope for this.

Propose the new schemas in PLAN section 3 marked "proposed in B14", then build them; the orchestrator reviews before merge. Codex: no `advisor`; follow the README's Codex rule.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. `pnpm gate:b14` (fake CLIs): a message with two item references reaches the fake designer with both ids; a reference to an item of another project is refused; with two generation jobs running, a chat message starts a designer turn within 5 s.
3. `gate:b14` also: cancelling a queued generation job holds its item and a later `generation.start` runs it; cancelling a running job is refused.
4. Playwright: cancel a queued job from the Jobs tab and see the item held. Also: select an item, its chip shows, send, the message shows the chip; `@` lists objects and inserts a chip; clicking a chip in the thread selects the object.
