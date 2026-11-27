import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import { expect, test } from "vitest";
import { getSetupPlan } from "./get-setup-plan.ts";

function fixture() {
  const tool = { state: "present", path: "/tool", message: "Available" };
  return PreflightSchema.parse({
    checkedAt: new Date().toISOString(),
    agents: [],
    blender: tool,
    brew: tool,
    uv: tool,
    pythonEnv: tool,
    models: [
      "map-anything",
      "sam3-mlx",
      "sam2.1-hiera-large",
      "sam-3d-objects-mlx",
      "trellis2",
      "trellis2-sparse-decoder",
      "dinov3-vitl16",
      "rmbg2",
    ].map((id) => ({
      id,
      name: id,
      path: `/weights/${id}`,
      sizeBytes: 0,
      expectedSizeBytes: 1024 ** 3,
      state: id === "sam2.1-hiera-large" ? "present" : "missing",
    })),
    device: {
      memoryBytes: 16 * 1024 ** 3,
      modelStorageBytes: 6 * 1024 ** 3,
      appleSilicon: true,
    },
  });
}

test("room setup reuses installed SAM 2.1 and downloads only MapAnything", () => {
  const plan = getSetupPlan({
    preflight: fixture(),
    choices: ["reconstruction"],
  });
  expect(plan.targets).toEqual([
    { kind: "weights-download", modelId: "map-anything" },
  ]);
  expect(plan.needsHomebrew).toBe(false);
  expect(plan.storageShortfall).toBe(0);
});

test("both object engines download their shared dependency once and require enough disk space", () => {
  const plan = getSetupPlan({
    preflight: fixture(),
    choices: ["sam3d", "trellis2"],
  });
  expect(
    plan.targets.map((target) => "modelId" in target && target.modelId),
  ).toEqual([
    "sam-3d-objects-mlx",
    "trellis2",
    "trellis2-sparse-decoder",
    "dinov3-vitl16",
    "rmbg2",
  ]);
  expect(plan.downloadBytes).toBe(5 * 1024 ** 3);
  expect(plan.storageShortfall).toBe(1024 ** 3);
});
