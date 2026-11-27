import type { Config } from "@planner/shared/src/config/config-schema.ts";
import { buildMissingRequirementNotice } from "../preflight/build-missing-requirement-notice.ts";
import { checkBlender } from "../preflight/check-blender.ts";
import { resolveToolPaths } from "../preflight/resolve-tool-paths.ts";
import type { BulbViews } from "./create-bulb-queue.ts";
import { renderBulbViews } from "./render-bulb-views.ts";

/** Return a `renderViews` for the bulb queue that finds Blender, renders both views, and returns a missing-requirement notice instead when Blender is missing. */
export function createBulbViewRenderer(options: {
  env: NodeJS.ProcessEnv;
  config: () => Config;
  plannerHome: string;
  processPath: string;
}) {
  return async function renderViews(input: {
    modelPath: string;
    folder: string;
    signal: AbortSignal;
    onLine: (line: string) => void;
  }): Promise<BulbViews> {
    const paths = resolveToolPaths({
      env: options.env,
      config: options.config(),
      plannerHome: options.plannerHome,
    });
    const blender = await checkBlender({
      candidates: paths.blender,
      env: options.env,
    });
    const notice = buildMissingRequirementNotice({
      preflight: {
        checkedAt: new Date().toISOString(),
        agents: [],
        blender,
        uv: blender,
        pythonEnv: blender,
        models: [],
      },
      requirements: [{ kind: "blender" }],
    });
    if (notice) return { kind: "missing", notice };
    const views = await renderBulbViews({
      blender: blender.path,
      env: options.env,
      processPath: options.processPath,
      ...input,
    });
    return { kind: "rendered", ...views };
  };
}
