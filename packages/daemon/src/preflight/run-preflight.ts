import { existsSync, readFileSync } from "node:fs";
import { arch, platform, totalmem } from "node:os";
import { join } from "node:path";
import type { CodingAgentStatus } from "@planner/shared/src/agents/coding-agent-status-schema.ts";
import type { Preflight } from "@planner/shared/src/preflight/preflight-schema.ts";
import { z } from "zod";
import { checkBlender } from "./check-blender.ts";
import { checkTool } from "./check-tool.ts";
import { readFreeStorage } from "./read-free-storage.ts";
import { PYTHON_ENV_MARKER, readLockHash } from "./read-lock-hash.ts";
import type { ModelRegistry } from "./read-model-registry.ts";
import { readModelWeights } from "./read-model-weights.ts";
import { readStorageVolume } from "./read-storage-volume.ts";
import type { ToolPaths } from "./resolve-tool-paths.ts";

/** Check every tool, the Python env and each registry model's weights, and return what is present and missing. */
export async function runPreflight(options: {
  paths: ToolPaths;
  registry: ModelRegistry;
  env: NodeJS.ProcessEnv;
  pythonProjectDir: string;
  agents: Promise<CodingAgentStatus[]>;
}): Promise<Preflight> {
  const [agents, blender, brew, uv, python] = await Promise.all([
    options.agents,
    checkBlender({ candidates: options.paths.blender, env: options.env }),
    checkTool({
      name: "Homebrew",
      candidates: [options.paths.brew],
      env: options.env,
      timeoutMs: 5000,
      readVersion: (output) => /^Homebrew (\S+)/m.exec(output)?.at(1),
    }),
    checkTool({
      name: "uv",
      candidates: [options.paths.uv],
      env: options.env,
      timeoutMs: 5000,
      readVersion: (output) => /^uv (\S+)/m.exec(output)?.at(1),
    }),
    checkTool({
      name: "Python",
      candidates: [join(options.paths.pythonEnv, "bin", "python")],
      env: options.env,
      timeoutMs: 10_000,
      readVersion: (output) => /Python (\d+\.\d+\.\d+)/.exec(output)?.at(1),
    }),
  ]);
  const pythonEnv = (() => {
    if (python.state === "missing")
      return {
        ...python,
        path: options.paths.pythonEnv,
        message: existsSync(options.paths.pythonEnv)
          ? "The Python env is incomplete. Create it again."
          : "The Python env is not created.",
      };
    if (python.state !== "present") return python;
    if (!python.version?.startsWith("3.13."))
      return {
        ...python,
        state: "error" as const,
        message: `The Python env has Python ${python.version}; it needs 3.13. Create it again.`,
      };
    const syncedLockHash = (() => {
      try {
        return z
          .object({ lockSha256: z.string() })
          .parse(
            JSON.parse(
              readFileSync(
                join(options.paths.pythonEnv, PYTHON_ENV_MARKER),
                "utf8",
              ),
            ),
          ).lockSha256;
      } catch {
        return undefined;
      }
    })();
    if (syncedLockHash === undefined)
      return {
        ...python,
        state: "error" as const,
        message: "The Python env is incomplete. Create it again.",
      };
    if (syncedLockHash !== readLockHash(options.pythonProjectDir))
      return {
        ...python,
        state: "error" as const,
        message: "The Python env is older than uv.lock. Create it again.",
      };
    return python;
  })();
  return {
    checkedAt: new Date().toISOString(),
    agents,
    brew,
    device: {
      memoryBytes: totalmem(),
      localStorageBytes: readFreeStorage(options.paths.brew),
      pythonStorageBytes: readFreeStorage(options.paths.pythonEnv),
      modelStorageBytes: readFreeStorage(options.paths.weights),
      localVolume: readStorageVolume(options.paths.brew),
      pythonVolume: readStorageVolume(options.paths.pythonEnv),
      modelVolume: readStorageVolume(options.paths.weights),
      appleSilicon: platform() === "darwin" && arch() === "arm64",
    },
    blender,
    uv,
    pythonEnv,
    models: options.registry.models.map((model) =>
      readModelWeights({ model, weightsRoot: options.paths.weights }),
    ),
  };
}
