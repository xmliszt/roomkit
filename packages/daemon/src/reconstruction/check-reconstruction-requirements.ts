import { accessSync, constants } from "node:fs";
import type { ToolCheck } from "@planner/shared/src/preflight/preflight-schema.ts";
import {
  buildMissingRequirementNotice,
  type Requirement,
} from "../preflight/build-missing-requirement-notice.ts";
import type { ModelRegistry } from "../preflight/read-model-registry.ts";
import { readModelWeights } from "../preflight/read-model-weights.ts";

export function checkReconstructionRequirements(options: {
  python: string;
  weightsRoot: string;
  registry: ModelRegistry;
  hasFurniture: boolean;
  needsGeometry?: boolean;
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
  const models = options.registry.models.map((model) =>
    readModelWeights({ model, weightsRoot: options.weightsRoot }),
  );
  const segmentation =
    models.find(
      (model) => model.id === "sam3-mlx" && model.state === "present",
    ) ??
    models.find(
      (model) => model.id === "sam2.1-hiera-large" && model.state === "present",
    );
  const requirements: Requirement[] = [
    { kind: "python-env" },
    ...(options.needsGeometry === false
      ? []
      : [{ kind: "weights", modelId: "map-anything" } satisfies Requirement]),
  ];
  if (options.hasFurniture)
    requirements.push({
      kind: "weights",
      modelId: segmentation?.id ?? "sam3-mlx",
    });
  return {
    segmentationModel:
      segmentation?.id === "sam2.1-hiera-large" ? "sam2.1" : "sam3",
    notice: buildMissingRequirementNotice({
      setupFeature: "reconstruction",
      preflight: {
        checkedAt: new Date().toISOString(),
        agents: [],
        blender: pythonEnv,
        uv: pythonEnv,
        pythonEnv,
        models,
      },
      requirements,
    }),
  };
}
