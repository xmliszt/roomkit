import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export function assertReplayOutput(options: {
  source: string;
  output: string;
}) {
  const source = realpathSync(options.source);
  let parent = resolve(options.output);
  while (!existsSync(parent)) parent = dirname(parent);
  const target = realpathSync(parent);
  assert.ok(
    target !== source && !target.startsWith(`${source}${sep}`),
    "Output must be outside the read-only source project",
  );
  assert.ok(!existsSync(options.output), `Output exists: ${options.output}`);
}
