# A27 — Snapshot shows as a photo, with "Render" as the next step (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (snapshot, Render photo from B21, tokens, motion). The user asked for this on 2026-11-25. Web only; reuse B21's `render.start` with the `RenderView` and `hiddenSurfaceIds` captured at the moment of the snapshot. No contract change.

## Scope

1. Remove the separate "Render photo" button from the bottom-right (and its command palette entry becomes "Render the last snapshot", or is removed if there is no snapshot; your call, say which in DESIGN).
2. Snapshot (`⌘⇧S` and the camera button) works as today, including saving the PNG automatically, and then opens a **photo modal**: the snapshot shown like a printed photo, with a thin white border (a few px, slightly thicker at the bottom is fine), a soft shadow, centred over a dimmed view. Short appear animation per DESIGN motion rules (reduced-motion safe).
3. Under the photo, two actions: **Render realistic photo** (starts a B21 render job with the snapshot's camera and the same hidden surfaces) and **Close** (`Esc`, click outside). After starting a render, the modal says "Rendering… about 2 minutes. The photo will appear in chat." and can be closed; the job is in Jobs as before. While a render for that snapshot is running, the button is disabled with its progress.
4. The modal is not part of snapshots or renders, and does not block the editor once closed.
5. Docs: DESIGN (snapshot flow, photo modal, removal of the button).

## Gate

`pnpm check` plus one new e2e spec only (the user wants speed): snapshot opens the modal with the image, the PNG still downloads, "Render realistic photo" sends one `render.start` with the snapshot's view, Esc closes, no "Render photo" button remains. Update any existing spec that clicks the old button. Screenshot of the modal into `docs/work-packages/evidence/a27-photo-modal.png`. Commit and set the card to in-review as soon as that passes.
