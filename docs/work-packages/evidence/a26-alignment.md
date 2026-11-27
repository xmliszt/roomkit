# A26 alignment evidence

Gate: `pnpm check` passed: typecheck, lint (two existing image warnings), 977 tests in 133 files. The replacement fast gate supersedes the package's gate-script and other E2E requirements.

`PLANNER_PORT=63820 PLANNER_WEB_PORT=63821 PLANNER_EVIDENCE_DIR=/tmp/planner-a26-evidence pnpm exec playwright test -c apps/web/playwright.config.ts apps/web/e2e/alignment.spec.ts --project chromium-a5 --no-deps` passed: 1 test, 11.3 seconds. Use free ports when repeating it.

The one spec measures Jobs, Log, Chat diffs, object rows, picker rows, inspector numeric fields, room fields, surface inputs, context-menu columns, top strip, tool rail, capture rows, settings usage and model rows, and project rows. Column edges and heights tolerate 0.5 px. Fixtures include long names, failed jobs, retry/cancel actions, 0%, 70%, 100%, and an enabled lamp. The inspector remains 300 px with `overflow-x-hidden`; its panel and body have no horizontal overflow, and every input remains inside its padding. The light grid retains `minmax(0,1fr) 112px`. Units have their own fixed 2ch column.

A24, A25 and the orchestrator's inspector-width correction are merged. No contract changes or remaining orchestrator decisions.

No advisor tool was available. Routine choice: keep `HairlineRow` and share grid CSS on native labels, summaries and buttons. The first commit records the choice in DESIGN.

Cold review: ship yes after these fixes. `factory diff-audit --base orchestrator` listed zero findings.

| Finding | Triage | Severity / likelihood / scope | Resolution |
| --- | --- | --- | --- |
| Surface labels wrap in narrow panels | act | medium / likely / inspector | Nonwrapping truncated spans with full titles; measured tile inputs. |
| Missing top-strip and menu-column checks | act | medium / likely / test coverage | Long project name, top-strip bounds and centre lines, and menu title/shortcut edges measured. |

Interface-craft critique: this is a room editor for repeated numeric edits. Jobs now has consistent title, action, stage and percentage edges. Errors stay in expanded content. The grid rows preserve native disclosure, label and menu behaviour. The measured unit-column and bulb-action overflow findings are fixed; no remaining alignment finding was observed at 1440 × 900.

| Screen | Before | After |
| --- | --- | --- |
| Jobs | [before](a26/before-jobs.png) | [after](a26/after-jobs.png) |

Changed paths:

- `apps/web/e2e/alignment.spec.ts`
- `apps/web/e2e/mock-generation.ts`
- `apps/web/src/activity/log-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/capture/capture-photo-tile.tsx`
- `apps/web/src/capture/scale-form.tsx`
- `apps/web/src/chat/chat-thread.tsx`
- `apps/web/src/chat/diff-block.tsx`
- `apps/web/src/chat/media-block.tsx`
- `apps/web/src/editor/add-picker.tsx`
- `apps/web/src/editor/charging-port-type-picker.tsx`
- `apps/web/src/editor/generation/generation-actions.tsx`
- `apps/web/src/editor/inspector-body.tsx`
- `apps/web/src/editor/light-controls.tsx`
- `apps/web/src/editor/number-field.tsx`
- `apps/web/src/editor/object-context-menu.tsx`
- `apps/web/src/editor/objects/objects-panel.tsx`
- `apps/web/src/editor/room-panel.tsx`
- `apps/web/src/editor/surface-controls.tsx`
- `apps/web/src/editor/surface-number-input.tsx`
- `apps/web/src/editor/top-strip.tsx`
- `apps/web/src/jobs/cancel-job-button.tsx`
- `apps/web/src/jobs/job-row.tsx`
- `apps/web/src/jobs/retry-job-button.tsx`
- `apps/web/src/pages-ui/hairline-row.tsx`
- `apps/web/src/pages-ui/usage-row.tsx`
- `apps/web/src/settings/role-model-row.tsx`
- `apps/web/src/settings/settings-footer.tsx`
- `apps/web/src/settings/settings-page.tsx`
- `docs/DESIGN.md`
