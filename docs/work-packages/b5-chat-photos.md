# B5 — Photos in chat and media routes

Read `docs/work-packages/README.md` first. Spec: `python/README.md` (C1's intake and proposed photo record), `docs/PLAN.md` sections 2, 3 (chat blocks, chat events, WS protocol, the B5 paragraph in section 8) and 5.3; `docs/DESIGN.md` sections 4 (prompt bar: photos by attach, paste, drop; a photo with no text is a valid message) and 8.

## Contract (signed off by the chief engineer; implement as written, record in PLAN section 3)

1. `chat.send` gains optional `photoIds: string[]` (1–6 ids of photos already uploaded through the B1 photo route to this project). `text` becomes optional when `photoIds` is non-empty; a message with neither is rejected.
2. The user's chat message stores an `image` block per photo with `photoId` (not a URL), plus the text block when present.
3. **The designer sees each photo.** At upload the daemon makes an upright JPEG copy (EXIF orientation applied, 1568 px long side) behind one function, in the folder where C1's intake puts its vision copies; chat must not need the Python runtime. Try macOS `sips` first, but check orientation with a pixel test: earlier `sips` output came out sideways. The designer runs with no built-in tools today, so check each CLI's `--help` for an image input and pick the route per CLI (an image argument, or a Read tool limited to the copies folder). Any file access is limited to the copies folder and enforced in the PreToolUse hook. Update the `designer` row of the PLAN 5.3 table. With no text, the designer asks whether to add the object in the photo or use it as a reference for the selected object (DESIGN 4), as a `choice` block.
4. **GET routes** under B1's existing route prefix, with B1's Host check and the token rule for clients with no Origin: the photo's JPEG copy by default (Chromium does not draw HEIC; `?size=thumb` for a small copy), and cached link images. A plain `<img src>` sends no Origin, so the web app loads these images the way A3 loads asset files. Paths are validated ids, never joined from raw input.
5. `image` block rendering data: the web app builds the URL from `photoId`; the block schema keeps no host or URL.
6. **Photo origin.** The photo upload takes a required `origin`, `capture` or `chat`, stored in the photo record (C1's proposed record in `python/README.md` plus this field). M4 reads only `capture`, so a shop photo sent in chat never becomes reconstruction input. The final record shape goes to the orchestrator with the diff, before merge.

If the existing schemas make any of this impossible as written, stop and report the smallest change.

## Scope

`packages/shared`, `packages/daemon`, `packages/mcp` if the designer's tool list needs it, `roles/designer.md`, and in `apps/web` only the chat files (`apps/web/src/chat/`, `apps/web/src/editor/chat*`, `composer*`, the image loader they use, and in `apps/web/src/editor/editor-shell.tsx` only `sendChat` and `submitChat`): the composer (send photos: upload, then `chat.send` with `photoIds`; render `image` blocks from the new route; render link images from the new route). Remove the "sending photos comes next" note A5 added. Another agent (A6) edits the inspector and the Add popover; before your final gate, `git merge orchestrator` to pick up A6.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`.

## Gate

1. `pnpm check` passes; `gate:m0`, `gate:b1`, `gate:m2`, `gate:b3`, `gate:b4` and `pnpm test:e2e` pass.
2. `pnpm gate:b5` (fake CLIs, temp folders): upload two photos, send a photo-only message; the stored message has two `image` blocks; the fake designer turn receives both file paths and answers with a `choice` block; GET of each photo returns an upright JPEG (a HEIC fixture with a rotated orientation, pixel-checked); a GET with a foreign Origin, with no Origin and no token, with a bad id or with `..` is refused; a designer file read outside the copies folder is refused.
3. A Playwright test: attach a photo in the composer, send with text, the thread shows the photo thumbnail from the route (`naturalWidth > 0`).
4. One manual script per CLI, like `scripts/m2-real-claude.ts`: `scripts/b5-real-claude.ts` and `scripts/b5-real-codex.ts` send a render of the chair fixture (`blender/fixtures/chair-wrong-axes.glb` rendered by `blender/thumbnail.py`), not a room photo, and pass when the reply names a chair. The orchestrator runs them by hand.
