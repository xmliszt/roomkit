# B4 — Charging port types in the catalog

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 0 (the realism bar: no toy-like models), 3 (`AssetMeta`, normalization, anchors) and 4 (charging port); `docs/spikes/s4-blender-headless.md`. B1 added one charging port (`packages/shared/src/catalog/charging-port.ts`, `blender/catalog/`).

## What the user asked for

The charging port must come in different kinds, chosen by the user: the shape of the holes differs per socket standard. The user's home uses UK-style Type G (default).

## Scope (`packages/shared` catalog, `packages/daemon` catalog copy, `blender/catalog/`)

1. **A catalog family** `charging-port` with one asset per type, each a realistic wall plate (white plastic faceplate with a slight bevel and gloss, recessed socket face, correct hole shapes and spacing, switch rocker where the standard usually has one, screw covers where typical), built by one parametric Blender script and normalized as a wall item:
   - Type G (UK, Malaysia, Singapore): 13 A, three rectangular pins, with switch. Default.
   - Type G with USB-A and USB-C.
   - Type A/B (US, Japan): duplex.
   - Type C/F (Schuko, EU).
   - Type I (Australia, China).
   - USB-only plate (USB-A + USB-C).
   Single gang for each, plus a double-gang Type G. Real dimensions per standard (Type G single 86 × 86 mm); look the dimensions up and cite the source in the report.
2. **Catalog list in `packages/shared`:** each entry has `familyId`, `typeId`, a label, its asset id, size, mount, default height. The existing single `charging-port.ts` becomes the Type G entry; keep its asset id so existing projects still load.
3. **Switching type** is an `item.update` that changes `model.assetId` and `sizeM`, keeping the placement (the anchor stays at the back-face centre). If the current command schema cannot change `model`, bring the smallest contract change to the advisor first.
4. **Daemon:** copy the asset into a project when an item of that type is added or switched to; import does the same.
5. Thumbnails (`thumb.png`) for each type, for the UI picker.

Out of scope: `apps/web` (Track A adds the type picker in the inspector and the Add popover later). Do not edit `apps/web` beyond what typecheck needs.

## Gate

1. `pnpm check` passes; `gate:m0`, `gate:b1`, `gate:m2`, `gate:b3` still pass.
2. `pnpm gate:b4`: every catalog GLB passes the glTF validator and loads in three.js at its catalog size within 1 mm, anchored at the back-face centre; switching a placed port's type through WS keeps `alongM` and `heightM`, changes the asset, copies it into the project, and undo restores the old type.
3. `compare.png` outside the repo: each type's three.js render beside a reference photo of that socket type found on the web (do not commit the photos). The orchestrator shows it to the user.
