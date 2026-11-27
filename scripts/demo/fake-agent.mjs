#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { bulbSystemPrompt } from "../../packages/daemon/src/bulb/build-bulb-prompt.ts";
import { runFakeCli } from "../../test/fake-cli/run-fake-cli.mjs";
import { findReplayEntry } from "./find-replay-entry.ts";
import { replayDesignerTurn } from "./replay-designer-turn.ts";

function steps({ prompt }) {
  const source = process.env.DEMO_SOURCE;
  const data = JSON.parse(readFileSync(join(source, "replay.json"), "utf8"));
  const args = process.argv.slice(2);
  const roleIndex = args.indexOf("--append-system-prompt");
  const role = roleIndex < 0 ? "" : (args.at(roleIndex + 1) ?? "");
  if (role.startsWith("# Designer")) {
    const held = JSON.parse(process.env.DEMO_HELD ?? "[]");
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "designer", pid: process.pid })}\n`,
    );
    return replayDesignerTurn({
      source,
      projectFolder: process.cwd(),
      prompt,
      heldItems: data.entries
        .map((entry) => entry.item)
        .filter((item) => held.includes(item.name)),
    });
  }
  if (role.startsWith("# Surveyor")) {
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "surveyor", pid: process.pid })}\n`,
    );
    return [
      {
        kind: "tool",
        name: "inventory_submit",
        arguments: { objects: data.inventory.submission },
      },
    ];
  }
  if (role === bulbSystemPrompt) {
    const name = /^Find the bulb of "(.*)" \(mounted on/.exec(prompt)?.at(1);
    const bulb = data.entries.find((entry) => entry.item.name === name)?.bulb;
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "bulb", name, saved: bulb !== undefined, pid: process.pid })}\n`,
    );
    return [
      {
        kind: "text",
        text: JSON.stringify(
          bulb ?? {
            x: 0.5,
            y: 0.7,
            z: 0.5,
            beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
            shade: "translucent",
            lumens: 400,
          },
        ),
      },
    ];
  }
  assert.ok(
    existsSync(join(process.cwd(), "job.json")),
    `Unexpected replay agent turn: ${role.split("\n").at(0)}`,
  );
  const job = JSON.parse(readFileSync("job.json", "utf8"));
  if (job.surfaceId) {
    const surface = data.project.scene.room.surfaces[job.surfaceId];
    assert.ok(
      surface?.material,
      `No saved surface result for ${job.surfaceId}`,
    );
    writeFileSync("surface.py", "");
    writeFileSync("surface.json", JSON.stringify(surface));
    if (surface.material.textureAssetId) {
      for (const name of ["baseColor.png", "normal.png", "roughness.png"]) {
        const path = join(
          source,
          "assets",
          surface.material.textureAssetId,
          name,
        );
        if (existsSync(path)) copyFileSync(path, name);
      }
    }
    writeFileSync("notes.md", "Saved surface result");
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "surfacer", surfaceId: job.surfaceId, pid: process.pid })}\n`,
    );
    return [{ kind: "tool", name: "asset_submit" }];
  }
  const entry = findReplayEntry({
    entries: data.entries,
    jobId: basename(process.cwd()),
    job,
  });
  assert.equal(
    entry?.item.model.kind,
    "asset",
    `No saved asset for ${job.name}`,
  );
  copyFileSync(
    join(source, "assets", entry.item.model.assetId, "model.glb"),
    "raw.glb",
  );
  for (const name of ["model.py", "notes.md"]) {
    const path = join(
      source,
      "assets",
      entry.item.model.assetId,
      "source",
      name,
    );
    if (existsSync(path)) copyFileSync(path, name);
    else writeFileSync(name, "");
  }
  appendFileSync(
    process.env.DEMO_CALLS,
    `${JSON.stringify({ kind: "modeler", objectId: entry.objectId, pid: process.pid, at: Date.now() })}\n`,
  );
  return [
    {
      kind: "sleep",
      durationMs: Number(process.env.DEMO_PIECE_SECONDS) * 1000,
    },
    { kind: "tool", name: "asset_submit" },
  ];
}
await runFakeCli({ kind: "claude", scenario: { steps } });
