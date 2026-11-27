# A1 — Design tokens, fonts and layout shell

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` sections 1–4 and 7, and the approved mock `docs/mock/editor-mock.html` (an HTML fragment: wrap it in a page or serve it to open it). The mock is the visual reference; match its values.

## Scope (`apps/web` only)

1. **Tokens.** Every token in DESIGN 2 as CSS variables, Tailwind 4 theme, and the shadcn semantic mapping (`--background` = `--bg`, `--border` = `--line`, `--muted-foreground` = `--ink-dim`, `--primary` = `--accent`). Radius 2 px, 1 px borders, focus ring, 4 px spacing base. One light theme only.
2. **Fonts.** Geist Mono from the `geist` package with `next/font`; Instrument Serif with `next/font/google` (self-hosted after build). The type roles in DESIGN 3.
3. **Layout shell for `/projects/[id]`,** following DESIGN 4 and the mock: full-window canvas slot (an R3F `Canvas` that clears to `--bg`; no room drawing yet), top strip, tool rail, inspector slot (shown only with a selection; use a stub selection for now), prompt bar, chat panel with tabs Chat / Jobs / Log (empty states), job strip, sheet label. The composer morph between the prompt bar and the chat panel exactly as DESIGN 4 specifies (Motion `layoutId="composer"`, transforms only, opaque fill, no blur on the moving element, reduced motion swaps with no movement). Photo attach, paste and the drop frame as UI only (files are held in state, not sent).
4. **Keys:** `\` hides all chrome, `/` focuses the prompt, `V` `G` `R` switch tools. Others belong to later packages.
5. **Other pages** (`/`, `/settings`, `/projects/[id]/capture`): the 720 px centred column and hairline row pattern, with placeholder content.
6. Interface motion per DESIGN 7. Do not animate anything the table says is instant.

Out of scope: room and item rendering, snapping, the advanced panel's real fields, WS wiring beyond what M0 already has, chat content, iso figures. Do not edit `packages/` (another agent owns the daemon and contracts now).

## Gate

1. `pnpm check` passes.
2. Playwright tests (new, under `e2e/`), using free ports per the README:
   - at 1440 × 900 with panels collapsed, chrome covers under 8% of the window (sum of the visible chrome boxes);
   - `\` hides all chrome and shows it again;
   - opening chat moves the same composer element (same DOM node, text and focus kept) into the panel, and closing moves it back;
   - computed styles match the tokens (body background `#F4F1EA`, ink `#1B2430`, accent `#1E50E6`, Geist Mono on body text, Instrument Serif on the project title).
3. Screenshots of the editor shell (chat closed and open) and of `/settings`, saved outside the repo, and one `interface-craft` critique pass on them with its findings fixed or listed in your last message. Compare against the mock side by side.
