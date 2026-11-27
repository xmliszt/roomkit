# B25 — Replay a lamp's light switch (Claude agent)

Builds on B22 (`b22-replay-whole-project.md`) and B24 (`b24-replay-chat.md`). Code: `scripts/demo/`.

Switching "Light source" on in the inspector queues `bulb.find`. In a replay it now ends `done` with "placed the bulb":

1. **Fake Blender.** For `thumbnail.py` it copies the asset's `thumb.png` (next to `--input`) to `--output`, once per view.
2. **Fake agent.** A turn whose system prompt is `bulbSystemPrompt` answers with the item's saved bulb as JSON. `prepare-replay.ts` stores it on each entry as `bulb`: the item's saved `light`, else the last bulb record for the entry's asset that ended "placed the bulb". With neither, it answers x 0.5, y 0.7, z 0.5, a 90° downward beam, translucent shade and 400 lm. The entry is found by the item name in the prompt, so a renamed item gets the fallback, and two items with the same name get the first one's bulb.
3. **Process audit.** A `ps` sample killed by a signal is skipped, not reported. A Ctrl-C or the gate's group SIGINT otherwise reached the audit's own `ps` and failed the audit.

Gate: `vitest run test/fake-cli`, then `node scripts/demo/verify-replay-bulb.ts /path/to/project`. The script runs the replay, opens the project in its own headless browser, selects the mushroom table lamp in the Objects tab, closes the panel and switches "Light source" on. It checks that the bulb job ends `done` with "placed the bulb", no job failed, and the lamp's light is on at the saved emitter (0.5, 0.62, 0.5). It then sends SIGINT and checks `result.json` for no failed jobs and a clean process audit, two thumbnail calls (front, side) and one bulb turn that used the saved answer.
