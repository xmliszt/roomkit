// Rebuild model.glb, meta.json and thumb.png of every charging port type in packages/daemon/catalog.
// Usage: scripts/machine-lock.sh catalog node blender/catalog/build-charging-ports.ts [typeId...]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { z } from "zod";

const SIZE_TOLERANCE_M = 0.00001;
const here = import.meta.dirname;
const catalogRoot = join(here, "../../packages/daemon/catalog");
const blender = process.env.BLENDER ?? "blender";
const NormalizeResultSchema = z.object({
  nativeSizeM: z.object({
    width: z.number(),
    height: z.number(),
    depth: z.number(),
  }),
  triangleCount: z.number().int().positive(),
});

function runBlender(script: string, args: string[]) {
  const output = execFileSync(
    blender,
    [
      "--background",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      join(here, script),
      "--",
      ...args,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const line = output.split("\n").find((text) => text.startsWith("RESULT "));
  assert.ok(line, `${script} printed no RESULT line`);
  return JSON.parse(line.slice("RESULT ".length));
}

const requested = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), "planner-catalog-"));
try {
  for (const entry of CHARGING_PORT_TYPES.filter(
    (type) => requested.length === 0 || requested.includes(type.typeId),
  )) {
    const folder = join(catalogRoot, entry.assetId);
    mkdirSync(folder, { recursive: true });
    const raw = join(work, `${entry.typeId}.glb`);
    const normalized = join(work, `${entry.typeId}.normalized.glb`);
    const model = join(folder, "model.glb");
    runBlender("build_charging_port.py", [
      "--type",
      entry.typeId,
      "--output",
      raw,
    ]);
    const result = NormalizeResultSchema.parse(
      runBlender("../normalize.py", [
        "--input",
        raw,
        "--output",
        normalized,
        "--mount",
        entry.mount,
        "--expected-size",
        String(Math.max(...Object.values(entry.sizeM))),
      ]),
    );
    for (const axis of ["width", "height", "depth"] as const)
      assert.ok(
        Math.abs(result.nativeSizeM[axis] - entry.sizeM[axis]) <
          SIZE_TOLERANCE_M,
        `${entry.typeId} ${axis} is ${result.nativeSizeM[axis]} m, the catalog says ${entry.sizeM[axis]} m`,
      );
    copyFileSync(normalized, model);
    runBlender("../thumbnail.py", [
      "--input",
      model,
      "--output",
      join(folder, "thumb.png"),
      "--size",
      "256",
    ]);
    writeFileSync(
      join(folder, "meta.json"),
      `${JSON.stringify(
        {
          id: entry.assetId,
          kind: "catalog",
          nativeSizeM: entry.sizeM,
          mount: entry.mount,
          triangleCount: result.triangleCount,
          hasColorMask: false,
          provenance: { method: "procedural", sourcePhotoIds: [] },
        },
        undefined,
        2,
      )}\n`,
    );
    console.log(`${entry.typeId}: ${result.triangleCount} triangles`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
