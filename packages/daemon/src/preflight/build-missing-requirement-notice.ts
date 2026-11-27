import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { Preflight } from "@planner/shared/src/preflight/preflight-schema.ts";

export type Requirement =
  | { kind: "agent"; cli: "claude" | "codex" }
  | { kind: "blender" }
  | { kind: "uv" }
  | { kind: "python-env" }
  | { kind: "weights"; modelId: string };

type MissingRequirementNotice = Extract<ChatBlock, { kind: "notice" }>;

function describeMissing(options: {
  preflight: Preflight;
  requirement: Requirement;
}) {
  const { preflight, requirement } = options;
  switch (requirement.kind) {
    case "agent": {
      const agent = preflight.agents.find(
        (candidate) => candidate.cli === requirement.cli,
      );
      const name = requirement.cli === "claude" ? "Claude Code" : "Codex";
      if (agent?.status === "ready") return undefined;
      return {
        section: "agents" as const,
        setupFeature: requirement.cli,
        text:
          agent?.status === "sign-in"
            ? `${name} is not signed in. Sign in, then check again in Settings.`
            : `${name} is not installed on this Mac. Install it, then check again in Settings.`,
      };
    }
    case "blender":
      return preflight.blender.state === "present"
        ? undefined
        : {
            section: "blender" as const,
            setupFeature: "blender" as const,
            text: "This step needs Blender. Install it or pick its path in Settings.",
          };
    case "uv":
      return preflight.uv.state === "present"
        ? undefined
        : {
            section: "python" as const,
            text: "This step needs uv. Install it in Settings.",
          };
    case "python-env":
      return preflight.pythonEnv.state === "present"
        ? undefined
        : {
            section: "python" as const,
            text: "This step needs the Python env. Create it in Settings.",
          };
    case "weights": {
      const model = preflight.models.find(
        (candidate) => candidate.id === requirement.modelId,
      );
      return model?.state === "present"
        ? undefined
        : {
            section: "python" as const,
            text: `This step needs the ${model?.name ?? requirement.modelId} weights. Download them in Settings.`,
          };
    }
    default: {
      const exhaustive: never = requirement;
      return exhaustive;
    }
  }
}

/** Return a `missing-requirement` notice for the first of `requirements` that `preflight` does not report present, or `undefined` when all are present. */
export function buildMissingRequirementNotice(options: {
  preflight: Preflight;
  requirements: Requirement[];
  setupFeature?: "reconstruction" | "sam3d" | "trellis2";
}): MissingRequirementNotice | undefined {
  const missing = options.requirements
    .map((requirement) =>
      describeMissing({ preflight: options.preflight, requirement }),
    )
    .find((entry) => entry !== undefined);
  if (missing === undefined) return undefined;
  const setupFeature = options.setupFeature ?? missing.setupFeature;
  return {
    kind: "notice",
    text: missing.text,
    detail: {
      kind: "missing-requirement",
      settingsSection: missing.section,
      ...(setupFeature === undefined ? {} : { setupFeature }),
    },
  };
}
