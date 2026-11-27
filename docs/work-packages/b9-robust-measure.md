# B9 — Robust object measurement and gate scoring

Read `docs/work-packages/README.md` first. Spec: `docs/work-packages/b7-inventory.md`, `docs/work-packages/b8-inventory-fixes.md`, `python/workers/measure.py`, `python/workers/segment.py`, `scripts/b7-real-inventory.ts`.

Measure each view independently, prefer views that show most of the item, and use agreement between views to reject outliers. Remove points that also belong to another object's mask before estimating dimensions. The regression test uses synthetic overlapping point clouds.

Match each benchmark item by the head noun of its name. Each target must match a different item.

Run `pnpm gate:b7` and the [Python unit tests](../../python/README.md#verification).
