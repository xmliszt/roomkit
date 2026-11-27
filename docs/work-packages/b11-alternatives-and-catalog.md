# B11 — Connect "try another version" to the image-to-3D workers; refresh catalog copies

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 ("Generation contracts" from B10), 5.1 (decision paragraph), and the "Catalog refresh" paragraph in section 8; `python/README.md` and `python/workers/generate_trellis.py`, `generate_sam3d.py` (C3); `docs/spikes/s2-image-to-3d.md` (axes per generator).

## Scope (`packages/daemon`, `packages/shared` only if a schema must change, `scripts/`)

1. **Alternatives adapter.** B10 left the image-to-3D call behind one function. Connect it to C3's workers through the B6 python runner: TRELLIS.2 gets the RGBA crop, SAM 3D the photo plus mask; then `normalize.py` with each generator's source axes, the PLAN 5.1 gate, and an `asset` chat block per result without replacing the current item. Both run one at a time under the machine lock. A missing weight gives the missing-requirement notice.
2. **Catalog refresh.** On project open, replace a project's copy of a catalog asset whose files differ from the catalog's (hash), keeping item placements. Test with a stale copy.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `pnpm check`, all gates and `pnpm test:e2e` pass.
2. `pnpm gate:b11` (fake workers): `generation.alternatives` produces two asset blocks with normalized GLBs and leaves the item's model unchanged; a stale catalog copy is replaced on open.
3. `scripts/b11-real-alternatives.ts`, run by the orchestrator: both real workers on the inventory sofa in a temp project (`process.env` spread first, per README rule 12); both GLBs pass the gate.
