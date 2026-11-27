import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROLE_TOOLS } from "@planner/mcp/src/role-tools.ts";
import { writeMcpConfig } from "@planner/mcp/src/write-mcp-config.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { Photo } from "@planner/shared/src/photos/photo-schema.ts";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { createTurnSlots } from "../chat/create-turn-slots.ts";

export async function runSurveyorTurn(options: {
  projectId: string;
  projectFolder: string;
  turnId: string;
  photos: Extract<Photo, { kind: "accepted" }>[];
  role: Config["roles"]["surveyor"];
  runtime: ReturnType<typeof createAgentRuntime>;
  slots: ReturnType<typeof createTurnSlots>;
  link: { wsUrl: string; token: string };
  rolePromptPath: string;
  signal: AbortSignal;
  onText: (text: string) => void;
}) {
  const release = await options.slots.acquire(options.signal);
  if (!release) options.signal.throwIfAborted();
  const dir = join(
    options.projectFolder,
    ".planner",
    "sessions",
    `turn-${options.turnId}`,
  );
  try {
    const tools = ROLE_TOOLS.surveyor.map((name) => `mcp__planner__${name}`);
    const mcpConfigPath = writeMcpConfig({
      projectId: options.projectId,
      turnId: options.turnId,
      role: "surveyor",
      allowedTools: tools,
      ...options.link,
      dir,
    });
    const photos = options.photos.map((photo) => ({
      photoId: photo.photoId,
      path: join(options.projectFolder, "photos", photo.visionPath),
      widthPx: photo.visionWidthPx,
      heightPx: photo.visionHeightPx,
    }));
    const visionDir = join(options.projectFolder, "photos", "vision");
    const result = await options.runtime.runTurn({
      project: options.projectFolder,
      session: {
        id: `surveyor-${options.turnId}-1`,
        role: "surveyor",
        cli: options.role.cli,
      },
      model: options.role.model,
      systemPrompt: readFileSync(options.rolePromptPath, "utf8"),
      prompt: `Inspect every capture photo and submit the room inventory with inventory_submit. Use these vision-copy pixel dimensions for every box. Include every visible view of each object. Never estimate sizes.\n${JSON.stringify(photos)}`,
      mcpConfigPath,
      allowedTools: options.role.cli === "claude" ? [...tools, "Read"] : tools,
      imagePaths:
        options.role.cli === "codex" ? photos.map((photo) => photo.path) : [],
      readableDirs: [visionDir],
      extraEnv: { PLANNER_READ_ROOT: visionDir },
      readOnly: true,
      signal: options.signal,
      onEvent(event) {
        if (event.kind === "assistant_text") options.onText(event.text);
      },
    });
    options.signal.throwIfAborted();
    if (result.isError || result.interrupted || result.usageLimit)
      throw new Error(
        result.usageLimit?.message ?? result.finalText ?? "Surveyor failed",
      );
  } finally {
    release?.();
    rmSync(dir, { recursive: true, force: true });
  }
}
