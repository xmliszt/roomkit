import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";

test.each([
  { missingChair: false, expectedCode: 0 },
  { missingChair: true, expectedCode: 1 },
])(
  "colour gate requires the chair as well as visible wall probes ($missingChair)",
  async (options) => {
    const root = mkdtempSync(join(tmpdir(), "planner-b21-colour-"));
    try {
      const orange = await sharp({
        create: { width: 16, height: 32, channels: 3, background: "#e9a15b" },
      })
        .png()
        .toBuffer();
      const image = join(root, "render.png");
      await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#8c8c8c" },
      })
        .composite([{ input: orange, left: 16, top: 0 }])
        .png()
        .toFile(image);
      const wallProbes = [3, 5, 7].map((x) => ({
        id: "wall",
        kind: "wall",
        x,
        y: 3,
      }));
      const chairProbes = [19, 21, 23].map((x) => ({
        id: "chair",
        kind: "item",
        x,
        y: 3,
      }));
      const metrics = join(root, "metrics.json");
      writeFileSync(
        metrics,
        JSON.stringify({
          metrics: {
            requiredColourIds: ["wall", "chair"],
            colourProbes: [
              ...wallProbes,
              ...(options.missingChair ? [] : chairProbes),
            ],
          },
        }),
      );
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/b21-check-look.ts"), image, image, metrics],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PLANNER_HOME: join(root, "home"),
            PLANNER_PROJECTS: join(root, "projects"),
          },
        },
      );
      expect(result.status, result.stderr).toBe(options.expectedCode);
      if (options.missingChair) expect(result.stdout).toContain('"chair"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
