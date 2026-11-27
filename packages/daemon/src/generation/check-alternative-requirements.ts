import { accessSync, constants } from "node:fs";
import type { ToolCheck } from "@planner/shared/src/preflight/preflight-schema.ts";
import {
  buildMissingRequirementNotice,
  type Requirement,
} from "../preflight/build-missing-requirement-notice.ts";
import type { ModelRegistry } from "../preflight/read-model-registry.ts";
import { readModelWeights } from "../preflight/read-model-weights.ts";

export function checkAlternativeRequirements(options: {
  python: string;
  weightsRoot: string;
  registry: ModelRegistry;
  method: "trellis2" | "sam3d";
  hasMask: boolean;
}) {
  const pythonEnv: ToolCheck = {
    state: "present",
    path: options.python,
    message: "Python worker executable",
  };
  try {
    accessSync(options.python, constants.X_OK);
  } catch {
    pythonEnv.state = "missing";
  }
  const modelIds = [
    ...(options.method === "trellis2"
      ? ["trellis2", "trellis2-sparse-decoder", "dinov3-vitl16"]
      : ["sam-3d-objects-mlx"]),
    ...(options.hasMask ? [] : ["rmbg2"]),
  ];
  return buildMissingRequirementNotice({
    setupFeature: options.method,
    preflight: {
      checkedAt: new Date().toISOString(),
      agents: [],
      blender: pythonEnv,
      uv: pythonEnv,
      pythonEnv,
      models: options.registry.models
        .filter((model) => modelIds.includes(model.id))
        .map((model) =>
          readModelWeights({ model, weightsRoot: options.weightsRoot }),
        ),
    },
    requirements: [
      { kind: "python-env" },
      ...modelIds.map(
        (modelId) => ({ kind: "weights", modelId }) satisfies Requirement,
      ),
    ],
  });
}
