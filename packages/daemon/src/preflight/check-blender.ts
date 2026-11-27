import { checkTool } from "./check-tool.ts";

const FIRST_LAUNCH_TIMEOUT_MS = 30_000;

/** Run `--version` on the first executable Blender in `candidates` and return a `ToolCheck` with `state` `present`, `missing` or `error`. */
export function checkBlender(options: {
  candidates: string[];
  env: NodeJS.ProcessEnv;
}) {
  return checkTool({
    name: "Blender",
    candidates: options.candidates,
    env: options.env,
    timeoutMs: FIRST_LAUNCH_TIMEOUT_MS,
    readVersion: (output) => /Blender (\d+\.\d+(?:\.\d+)?)/.exec(output)?.at(1),
  });
}
