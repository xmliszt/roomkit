import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createTokenScrubber } from "../util/create-token-scrubber.ts";
import type { EventBus } from "../ws/event-bus.ts";

export function createJobOutputLog(options: {
  bus: EventBus;
  env: NodeJS.ProcessEnv;
}) {
  const indexes: { [jobId: string]: number } = Object.create(null);
  const redact = createTokenScrubber(options.env);
  return function append(input: { jobId: string; path: string; line: string }) {
    const lines = redact(stripVTControlCharacters(input.line))
      .split(/\r\n|\r|\n/)
      .filter((line) => line.trim());
    if (lines.length === 0) return;
    const firstLineIndex =
      indexes[input.jobId] ??
      (existsSync(input.path)
        ? readFileSync(input.path, "utf8").split("\n").length - 1
        : 0);
    mkdirSync(dirname(input.path), { recursive: true });
    appendFileSync(input.path, `${lines.join("\n")}\n`, { mode: 0o600 });
    indexes[input.jobId] = firstLineIndex + lines.length;
    options.bus.publish({
      kind: "job.log",
      jobId: input.jobId,
      firstLineIndex,
      lines,
    });
  };
}
