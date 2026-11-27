import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import type { Config } from "@planner/shared/src/config/config-schema.ts";

function uvPath(env: NodeJS.ProcessEnv) {
  const paths = [
    "/opt/homebrew/bin/uv",
    ...(env.HOME ? [join(env.HOME, ".local/bin/uv")] : []),
    ...(env.PATH ?? "")
      .split(":")
      .filter(Boolean)
      .map((folder) => join(folder, "uv")),
  ];
  return (
    paths.find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? "/opt/homebrew/bin/uv"
  );
}

const DEFAULT_BLENDER_PATHS = [
  "/opt/homebrew/bin/blender",
  "/Applications/Blender.app/Contents/MacOS/Blender",
];

/** Return the paths for `brew`, `uv`, the `blender` candidates, the Python env and the model weights. */
export function resolveToolPaths(options: {
  env: NodeJS.ProcessEnv;
  config: Config;
  plannerHome: string;
}) {
  const pythonRoot = join(options.plannerHome, "python");
  return {
    // Not the first `brew` in PATH: `/usr/local/bin/brew` builds from source.
    brew: options.env.PLANNER_BREW_BIN || "/opt/homebrew/bin/brew",
    uv: options.env.PLANNER_UV_BIN || uvPath(options.env),
    blender: options.config.blenderPath
      ? [options.config.blenderPath]
      : options.env.BLENDER
        ? [options.env.BLENDER]
        : DEFAULT_BLENDER_PATHS,
    pythonEnv: join(pythonRoot, ".venv"),
    weights: options.env.PLANNER_WEIGHTS_DIR ?? join(pythonRoot, "weights"),
  };
}

export type ToolPaths = ReturnType<typeof resolveToolPaths>;
