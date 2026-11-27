# F5 — Colour masks that cover whole parts

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 ("Colour": colorMask, `referenceLuma`, the `colorize` formula), 5.1 step 3 (`normalize.py`); `blender/normalize.py` (`write_color_mask`), `blender/recolor.py`, `blender/glb_io.py`, `apps/web/src/editor/scene/asset-model.tsx` (mask sampling), the Blender tests in `blender/tests/`.

## Bug (seen in the user's app)

Recolouring the yellow suede "Sofa chair (caterpillar style)" (asset `39695c1b…` in the user's project) changes only scattered patches to a dirty orange; hue/saturation/brightness do the same. Its `colorMask.png` is pixel noise: `docs/work-packages/evidence/f5-togo-colormask.png`. Cause: `write_color_mask` runs k-means per texel on the baked base-colour atlas with a luma feature, so the suede's baked shading and texture variation split one fabric into two clusters; every texel decides alone, and unused atlas space counts too.

## Scope (`blender/`, `packages/daemon` only if the sidecar call changes, `scripts/`, `docs/PLAN.md`)

1. **Part-level mask.** Decide per surface region, not per texel:
   - Multiple materials: group faces by material; the recolourable region is the material group(s) whose mean colour belongs to the largest cluster measured by **surface area** (not texel count).
   - One material (baked atlas): give each face the mean colour of the texels under its UV triangle; cluster faces by chroma (hue and saturation; luma at low weight so shading does not split a fabric); smooth by majority vote over connected faces; then rasterise each chosen face's whole UV triangle into the mask and dilate 2 px to cover UV seams.
   - Unused atlas texels are never "chosen" and never counted.
   - `referenceLuma` is the median luma over the chosen faces' texels.
2. **Repair existing assets.** `scripts/f5-rebuild-masks.ts <project-folder> [--apply]` reruns only the mask step in Blender for every generated asset (`hasColorMask: true`), rewriting `colorMask.png` and `referenceLuma` in `meta.json`, geometry and textures untouched; dry-run prints old and new mask coverage per asset. Uses the machine lock. The orchestrator runs it on the user's project after merge.
3. Keep the shader and `recolor.py` formula unchanged unless a measured problem shows otherwise; if the editor needs to reload masks after the repair, bump the asset cache key the way existing code does.
4. Update PLAN's "Colour" paragraph to describe the part-level mask.

## Gate

`pnpm check`, all gates, `bash blender/tests/run.sh` pass. New Blender fixtures: (a) a one-material upholstered chair with strongly baked shading and fabric noise plus darker wooden legs: the mask covers at least 95% of the fabric faces' UV area and under 5% of the legs', and fewer than 1% of mask pixels are isolated (no 8-neighbour of the same value); (b) a two-material sofa (fabric, metal): the mask is exactly the fabric material's UV area. Run the rebuild script in dry-run on a copy of the user's project and include the Togo chair's new mask image in the evidence; colourising it to blue in the editor turns the whole upholstery blue (screenshot).
