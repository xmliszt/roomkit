# A26 — Pixel alignment across the app (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md`. The user asked for this on 2026-11-25 (relayed by the chief engineer session); the request is below as written. Web only. A25 (Roomkit rename, new settings footer) runs in parallel and rewrites the settings page: do settings last, after A25 merges into `orchestrator` (merge `orchestrator` often). Make the shared row component part of DESIGN. If you have no advisor tool, write your choice of shared row component and the reasoning in your first commit and continue. The user asked to skip the full e2e: run `pnpm check`, all gate scripts, the new alignment spec and directly affected specs only.

Relayed from the user by the chief engineer session. The user is strict about alignment: every repeated element must line up to the pixel. Run this as a work package after the Roomkit rename, or before it if the rename is still waiting.

## 1. The Jobs list (reported with a screenshot)

File: `apps/web/src/jobs/job-row.tsx` and `retry-job-button.tsx`. Causes found in the code:

- The summary row is `inline-flex justify-between` with four children (title, cancel, retry, status). `justify-between` spreads the free space between them, so the retry button floats at a different x on every row.
- The status is one string, `` `${job.stage} · ${pct}%` ``, aligned by its right edge. "ready" and "failed", and "0%", "70%" and "100%", have different widths, so the word, the dot and the number sit at different x on every row.
- The status can wrap: a long title pushed "ready · 100%" onto two lines.
- The title has no fixed right edge, so long titles truncate at different points.
- The retry button is `min-h-7` (28 px), taller than a text row, so rows with a button are taller than rows without.
- `w-[calc(100%-20px)]` is a hand-tuned offset for the disclosure marker.

Fix: make the summary a CSS grid with fixed columns, the same on every row:

| Column | Width | Content |
|---|---|---|
| marker | fixed | the disclosure triangle, drawn by the row, not the browser |
| title | `minmax(0, 1fr)` | `truncate`, so every title ends at the same edge |
| action | fixed, wide enough for "retry" or "cancel" | the button, right-aligned in the slot; the slot is reserved even when empty |
| stage | fixed, `7ch` or the widest stage word | left-aligned word |
| percent | fixed, `4ch` | right-aligned, `tabular-nums` |

Drop the "·" separator, or give it its own fixed column. Every cell `whitespace-nowrap`. The button's height must not exceed the text line (about 24 px), so every row is the same height. The retry error message moves into the expanded body.

## 2. The whole app

Audit every screen for the same faults and fix them: Jobs, Log, Chat, the inspector, the advanced panel, the objects panel, the + picker, context menus, settings, the capture page, the project list, the top strip and the tool rail.

Rules:

- Repeated rows use a grid with fixed column widths, not `justify-between` or free flex spacing.
- Numbers use `tabular-nums` and are right-aligned in a fixed-width column; units sit in their own column or share the number's right edge.
- Labels in label/value lists share one left edge and values share one edge (left or right, the same for the whole list).
- Every row in a list is the same height; buttons inside rows are no taller than the row's text line.
- Text never wraps inside a status or number cell.
- Panel contents share the panel's padding edge; headings, rows and dividers start at the same x.
- Icons align to the text's centre line; icon-only buttons are square and the same size within a group.
- No hand-tuned pixel offsets such as `calc(100% - 20px)` to correct alignment.

## Gate

A Playwright alignment check that runs on every list and panel listed above with realistic data, including long names, failed jobs, retry buttons, 0% and 100%:

- for each column, the left x (or right x, for right-aligned columns) of every row's cell is equal within 0.5 px;
- every row in a list has the same height within 0.5 px;
- no status or number cell wraps.

Attach before and after screenshots of each screen to the evidence. Call the advisor before choosing the shared row component and before reporting.
