#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runFakeCli } from "../../../../test/fake-cli/run-fake-cli.mjs";
import { steps as generationSteps } from "../../../../test/fake-cli/scenarios/generation.mjs";

await runFakeCli({
  kind: process.argv.includes("exec") ? "codex" : "claude",
  scenario: {
    steps({ prompt }) {
      if (prompt.startsWith("Build the object in job.json.")) {
        const job = JSON.parse(
          readFileSync(join(process.cwd(), "job.json"), "utf8"),
        );
        return [
          ...(job.notes ? [{ kind: "sleep", durationMs: 1500 }] : []),
          ...generationSteps({ prompt }),
        ];
      }
      const references = JSON.parse(
        prompt
          .split("Referenced items (act on these IDs):\n")
          .at(-1)
          .split("\n")
          .at(0),
      );
      const itemId = references.at(0).itemId;
      if (!/regenerate this, the legs are oval/.test(prompt))
        throw new Error("Expected the user's regeneration correction");
      return [
        { kind: "tool", name: "scene_get" },
        {
          kind: "tool",
          name: "asset_regenerate",
          arguments(results) {
            if (
              !results.scene_get.scene.items.some((item) => item.id === itemId)
            )
              throw new Error("Referenced item is missing");
            return { itemId, notes: "the legs are oval" };
          },
        },
        { kind: "text", text: "Regenerating with oval legs." },
      ];
    },
  },
});
