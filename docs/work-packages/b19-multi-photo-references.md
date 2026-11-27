# B19 — Every reference photo reaches the object (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` (generation and regeneration contracts, section 3), `docs/DESIGN.md` (Objects panel sources), `roles/designer.md`, `roles/modeler.md`. Consult the advisor before committing to an approach and before calling it done. This changes the generation spec and MCP contracts; the orchestrator approved the additive shape below.

## The bug

The user uploads several photos of one object from different angles. Only one is kept:

- `GenerationReferenceSchema` (`packages/shared/src/generation/generation-spec-schema.ts`) holds one `{kind: "photo", photoId}`; `asset_generate` (`packages/mcp/src/tools/asset-generate.ts`) and `roles/designer.md` pass one.
- `prepare-generation-folder.ts` copies that one photo to `photos/reference.jpg`, so the modeler sees one view. Room-inventory objects already get every view; keep that branch as it is.
- `read-item-sources.ts` returns one photo for a `photo` source, so the Objects panel shows one.
- `RegenerationSpecSchema` holds only `{itemId, notes}`. When the user asked to refine the yellow sofa chair with 3 new photos, the designer put their paths in `notes`; the modeler cannot read outside its job folder and got ENOENT.

Real cases in the user's project: bean bag sofa (job `8a0e55b8`, 3 uploads, 1 used: the 480 px front view) and the yellow sofa chair (job `09c2f9fd`, 3 extra references unused).

## Scope

1. **Schema, additive:** the photo reference keeps `photoId` (the primary photo) and gains optional `extraPhotoIds: IdSchema[]` (no duplicates, not containing `photoId`, a sane max such as 12). Every record already on disk must parse unchanged; no migration.
2. **Generation:** copy every photo into the job folder (`photos/<photoId>.jpg`), primary first, and list them all in `job.json`. TRELLIS.2 / SAM 3D take one image: keep `run-alternative-worker.ts` on the first photo, which is the primary.
3. **Regeneration:** `RegenerationSpecSchema` and `asset_regenerate` accept optional `photoIds`. They are added to the item's saved source (deduped, existing primary kept unless the designer explicitly sets a new primary), so retries, later regenerations, alternatives and the Objects panel all see them. For an object whose source is the room inventory, extra chat photos are stored alongside the inventory views and also copied into the job folder; decide the exact shape and note it in PLAN.
4. **Sources read:** `read-item-sources.ts` returns one entry per photo, primary marked `isBest`.
5. **Every consumer:** grep every use of the photo reference kind and the regeneration spec (retry key, alternatives, duplicate/mirror, `objects.library`, archive/restore, `get-source-origin.ts`, chat references) and make each handle the extra photos.
6. **Roles:** `roles/designer.md`: pass all photos of the object; primary = the clearest, highest-resolution view of the actual object (not a differently coloured example); use `photoIds` on regenerate, never paths in notes. `roles/modeler.md`: shape from all photos, colour and material from the primary.
7. **Docs:** update `docs/PLAN.md` section 3 contracts in this branch.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` (outside ports 3210 and 4820). Tests: an old-form record (`{kind:"photo", photoId}` only) parses; a 3-photo generation puts 3 photos in the job folder and `job.json`, primary first; regenerate with `photoIds` merges them into the saved source and the next job gets them; `items.sources` returns all photos; an alternative uses the primary. Plus a read-only script `scripts/b19-parse-project.ts <projectDir>` that parses every saved generation, regeneration and job record in a project with the new schemas and reports failures; run it on `/path/to/project` (read only) and put the output in `docs/work-packages/evidence/b19-parse-project.txt`.
