import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import type { Preflight } from "@planner/shared/src/preflight/preflight-schema.ts";
import {
  AGENT_SETUP_BYTES,
  BLENDER_SETUP_BYTES,
  PYTHON_SETUP_BYTES,
  STORAGE_HEADROOM_BYTES,
} from "@planner/shared/src/preflight/setup-storage.ts";

export const setupChoices = [
  {
    id: "claude",
    label: "Claude Code",
    description: "setup.claudeDescription",
  },
  {
    id: "codex",
    label: "Codex",
    description: "setup.codexDescription",
  },
  {
    id: "blender",
    label: "Blender",
    description: "setup.blenderDescription",
  },
  {
    id: "reconstruction",
    labelKey: "setup.rebuildRooms",
    description: "setup.reconstructionDescription",
  },
  {
    id: "sam3d",
    labelKey: "setup.sam3dLabel",
    description: "setup.sam3dDescription",
  },
  {
    id: "trellis2",
    labelKey: "setup.trellis2Label",
    description: "setup.trellis2Description",
  },
] as const;

export type SetupChoice = (typeof setupChoices)[number]["id"];

export function getSetupPlan(options: {
  preflight: Preflight;
  choices: readonly SetupChoice[];
}) {
  const { preflight, choices } = options;
  const agents = preflight.agents.filter((agent) =>
    choices.includes(agent.cli),
  );
  const selectedAgents = agents.filter(
    (agent) => agent.status === "not-installed" || agent.status === "error",
  );
  const objectModels =
    choices.includes("sam3d") || choices.includes("trellis2");
  const reconstruction = choices.includes("reconstruction");
  const needsPython =
    (reconstruction || objectModels) && preflight.pythonEnv.state !== "present";
  const needsUv = needsPython && preflight.uv.state !== "present";
  const needsBlender =
    (choices.includes("blender") || objectModels) &&
    preflight.blender.state !== "present";
  const sam3 = preflight.models.find((model) => model.id === "sam3-mlx");
  const sam2 = preflight.models.find(
    (model) => model.id === "sam2.1-hiera-large",
  );
  const segmentation =
    sam3?.state === "present" || (sam3 && sam2?.state !== "present")
      ? "sam3-mlx"
      : "sam2.1-hiera-large";
  const modelIds = [
    ...(reconstruction ? ["map-anything", segmentation] : []),
    ...(objectModels ? ["rmbg2"] : []),
    ...(choices.includes("sam3d") ? ["sam-3d-objects-mlx"] : []),
    ...(choices.includes("trellis2")
      ? ["trellis2", "trellis2-sparse-decoder", "dinov3-vitl16"]
      : []),
  ];
  const missingModels = preflight.models.filter(
    (model) => modelIds.includes(model.id) && model.state !== "present",
  );
  const unlistedModels = modelIds.filter(
    (id) => !preflight.models.some((model) => model.id === id),
  );
  const downloadBytes = missingModels.reduce(
    (total, model) =>
      total + (model.remainingDownloadBytes ?? model.expectedSizeBytes),
    0,
  );
  const pythonBytes = needsPython ? PYTHON_SETUP_BYTES : 0;
  const localBytes =
    (needsBlender ? BLENDER_SETUP_BYTES : 0) +
    (selectedAgents.length + Number(needsUv)) * AGENT_SETUP_BYTES;
  const device = preflight.device;
  const volumes = [
    {
      volume: device?.localVolume,
      available: device?.localStorageBytes,
      bytes: localBytes,
    },
    {
      volume: device?.pythonVolume,
      available: device?.pythonStorageBytes,
      bytes: pythonBytes,
    },
    {
      volume: device?.modelVolume,
      available: device?.modelStorageBytes,
      bytes: downloadBytes,
    },
  ];
  const storageShortfall = Math.max(
    0,
    ...volumes.map((entry) => {
      if (entry.available === undefined || entry.bytes === 0) return 0;
      const required =
        entry.volume === undefined
          ? entry.bytes
          : volumes
              .filter((volume) => volume.volume === entry.volume)
              .reduce((sum, volume) => sum + volume.bytes, 0);
      return required + STORAGE_HEADROOM_BYTES - entry.available;
    }),
  );

  const targets: InstallTarget[] = [
    ...selectedAgents.map(
      (agent) => ({ kind: "agent", cli: agent.cli }) satisfies InstallTarget,
    ),
    ...(needsBlender ? [{ kind: "blender" } satisfies InstallTarget] : []),
    ...(needsUv ? [{ kind: "uv" } satisfies InstallTarget] : []),
    ...(needsPython ? [{ kind: "python-env" } satisfies InstallTarget] : []),
    ...missingModels.map(
      (model) =>
        ({
          kind: "weights-download",
          modelId: model.id,
        }) satisfies InstallTarget,
    ),
  ];

  return {
    targets,
    downloadBytes,
    toolBytes: pythonBytes + localBytes,
    storageShortfall,
    needsHomebrew: localBytes > 0 && preflight.brew?.state !== "present",
    requiresAppleSilicon:
      (reconstruction || objectModels) && device?.appleSilicon === false,
    unlistedModels,
  };
}
