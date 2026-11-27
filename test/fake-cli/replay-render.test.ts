import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test.each(["saved", "override", "override-without-saved"])(
  "fake photo render uses render source=%s and reports samples without Blender",
  (mode) => {
    const override = mode !== "saved";
    const root = mkdtempSync(join(tmpdir(), "planner-replay-render-"));
    try {
      mkdirSync(join(root, "renders"));
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      );
      writeFileSync(join(root, "renders", "new.png"), png);
      writeFileSync(join(root, "renders", "old.png"), "old");
      writeFileSync(
        join(root, "replay.json"),
        JSON.stringify({
          renders:
            mode === "override-without-saved" ? [] : ["new.png", "old.png"],
        }),
      );
      const custom = join(root, "custom.png");
      const customPng = Buffer.concat([png, Buffer.from("override")]);
      writeFileSync(custom, customPng);
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/demo/fake-blender.mjs"),
          "--python",
          "render_photo.py",
          "--",
          join(root, "scene.json"),
        ],
        {
          env: {
            ...process.env,
            DEMO_SOURCE: root,
            DEMO_CALLS: join(root, "calls.jsonl"),
            DEMO_RENDER_SECONDS: "0",
            DEMO_RENDER_IMAGE: override ? custom : undefined,
          },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(root, "render.png"))).toEqual(
        override ? customPng : png,
      );
      expect(result.stdout).toBe(
        "Sample 1 / 4\nSample 2 / 4\nSample 3 / 4\nSample 4 / 4\n",
      );
      expect(
        JSON.parse(readFileSync(join(root, "calls.jsonl"), "utf8")),
      ).toMatchObject({
        kind: "render",
        source: override ? custom : "new.png",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
