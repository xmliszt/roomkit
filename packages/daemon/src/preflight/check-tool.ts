import { accessSync, constants, statSync } from "node:fs";
import type { ToolCheck } from "@planner/shared/src/preflight/preflight-schema.ts";
import { exec } from "../util/exec.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Run `--version` on the first executable path in `candidates` and return a `ToolCheck` with `state` `present`, `missing` or `error`. */
export async function checkTool(options: {
  name: string;
  candidates: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  readVersion: (output: string) => string | undefined;
}): Promise<ToolCheck> {
  const path = options.candidates.find(isExecutable);
  if (path === undefined)
    return {
      state: "missing",
      path: options.candidates.at(0) ?? "",
      message: `${options.name} is not installed.`,
    };
  const result = await exec({
    command: path,
    args: ["--version"],
    timeoutMs: options.timeoutMs,
    env: scrubbedEnv({ env: options.env }),
  });
  const version = options.readVersion(`${result.stdout}\n${result.stderr}`);
  if (result.timedOut || result.code !== 0 || version === undefined)
    return {
      state: "error",
      path,
      message: result.timedOut
        ? `${options.name} --version timed out.`
        : `${options.name} at this path did not report a version.`,
    };
  return {
    state: "present",
    path,
    version,
    message: `${options.name} ${version}`,
  };
}
