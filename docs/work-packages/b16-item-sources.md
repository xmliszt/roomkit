# B16 — Object library and source photos

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (inventory, generation sources from B10/B14/B18) and 5.2; `packages/daemon/src/generation/read-inventory-generations.ts`, `read-regeneration-source.ts`, `copy-saved-generation-sources.ts`. Feeds A12 (the Objects panel).

## Scope (`packages/shared`, `packages/daemon`)

1. **Read command `item.sources {projectId, itemId?}`** → for each item (or the one asked for): its origin (`inventory`, `chat-photo`, `web`, `prompt`, `variant`, `catalog`), the photos it came from as `{photoId, box?: [x0,y0,x1,y1] in 0–1 photo coordinates, isBest: boolean}` (inventory: every view the surveyor boxed, best view first; chat photo: that photo; web: the image URL and source page), and a crop route for each photo.
2. **Crop route** `GET /projects/:projectId/photos/:photoId/crop?box=x0,y0,x1,y1&size=256`: a JPEG of the box with 8% padding, longest side `size` (64–1024), cached on disk under `.planner/crops/`. Validate ids and numbers; reject a box outside 0–1.
3. **Read command `objects.library {projectId}`** → every object model in the project, placed or not: each object asset in `assets/` (not surface or catalog-socket assets, which stay in the built-in catalog) with `{assetId, name, nativeSizeM, thumbUrl, origin, createdAt, itemIds: string[]}` (the items currently using it; empty when not in the room, for example a kept-but-unused alternative or a model whose item was deleted), plus the built-in catalog entries (charging ports) marked `builtIn: true`. Newest first. Also `objects.archive {projectId, assetId}` and `objects.restore {projectId, assetId}`: archiving moves an unused asset to `.planner/archive/` (refused while any item uses it) so it leaves the library without deleting files; restore moves it back.
4. Use the saved generation sources (the same ones regeneration reads), so the answer matches what the modeler saw. Items with no source return an empty list.
5. Propose the schemas in PLAN section 3 marked "proposed in B16" and build them; Codex: follow the README's Codex rule.

## Gate

`pnpm check`, all gates pass; `pnpm gate:b16` (fixtures): an inventoried item returns its boxed views best-first with crop URLs that return JPEGs of the right size; a chat-photo item and a web item return their sources; a prompt item returns none; bad ids, a box outside 0–1 and `size` 5000 are rejected; a second crop request is served from the cache; `objects.library` lists placed and unplaced object assets with the right `itemIds`, excludes surface assets, includes the charging ports as built-in; archive refuses a used asset, removes an unused one from the list, and restore brings it back.
