# A21 — Voice input in chat, Web Speech API (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 1 item 7 and the technology table ("Voice (P2): Web Speech API first; local `mlx-whisper` later"), `docs/DESIGN.md` section on the chat composer ("(P2) a microphone button"), `docs/mock/editor-mock.html` for the composer's look. The user approved this for V1 on 2026-11-24. Web only: no daemon, shared or MCP changes. B20 runs in parallel in the daemon and Python; merge `orchestrator` often. Consult the advisor before committing to an approach and before calling it done.

## Scope

1. **Mic button** in the chat composer, beside the existing send and attach controls, styled from DESIGN tokens. States: idle, listening (visible pulse or level, reduced-motion safe), unavailable (hidden, or disabled with a tooltip, when the browser has no `SpeechRecognition` / `webkitSpeechRecognition`, as in Firefox).
2. **Live text.** Interim results show in the composer as they come; final results replace them. Text the user already typed stays; dictated text is appended at the cursor. Dictation never sends the message; the user reviews and presses Enter.
3. **Stop:** on the mic button, `Esc`, sending the message, closing the chat, and on silence (the recognizer's own end, plus a short silence timeout of your choosing; note the number in DESIGN). Restart cleanly on the next press.
4. **Shortcut.** `M` from the canvas opens chat and starts listening (check it is free in `get-shortcut-action.ts`; `C` toggles chat, `V` and `R` are tools). Inside the composer, pick a modifier shortcut that does not collide with macOS, Chrome or Safari defaults, or leave it to the button; say which in DESIGN. Add both to the shortcut sheet and to the button's `aria-keyshortcuts` without changing its accessible name ("mic" or "Voice input"; existing tests find the chat button by `aria-label="chat"`, do not break that pattern).
5. **Errors in plain words** inline under the composer: microphone permission denied, no microphone, network error (Chrome's recognizer is online), no speech heard. Language: the browser language (`navigator.language`).
6. **Works over the tailnet HTTPS address** (secure context) and on `localhost`. Note in DESIGN that Chrome sends audio to Google's speech service and Safari uses Apple's dictation; local Whisper is a later follow-up.
7. **Docs:** DESIGN composer section and shortcut list; PLAN section 1 item 7 and M5: voice input moved into V1 with the Web Speech API.

## Code

Follow the repo rules (`~/.claude/CLAUDE.md`): a factory or hook wrapping the recognizer with injected constructor so tests can pass a fake; discriminated union for its state (`idle | listening | unavailable | error`); cleanup that stops the recognizer on unmount.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` (outside ports 3210 and 4820). Unit tests for the state machine with a fake recognizer (interim then final, silence stop, error mapping, append at cursor). An e2e test that installs a fake `webkitSpeechRecognition` with `page.addInitScript`, presses `M`, emits interim and final results, and checks the composer text and that nothing was sent; one for the unavailable case. The real-microphone check in Chrome and Safari is done by the orchestrator after the merge; list the steps for it in your final card.
