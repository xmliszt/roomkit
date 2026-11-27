import { buildCodexArgs } from "./build-codex-args.ts";
import { createProcessRuntime } from "./create-process-runtime.ts";
import { decodeCodexEvent } from "./decode-codex-event.ts";

export function createCodexRuntime(
  options: {
    timeoutMs?: number;
    killGraceMs?: number;
    startupGraceMs?: number;
  } = {},
) {
  return createProcessRuntime({
    ...options,
    buildArgs: buildCodexArgs,
    decode: decodeCodexEvent,
  });
}
