import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { PLANNER_TOOL_PREFIX } from "@planner/mcp/src/planner-tool-prefix.ts";
import { ROLE_TOOLS } from "@planner/mcp/src/role-tools.ts";
import { writeMcpConfig } from "@planner/mcp/src/write-mcp-config.ts";
import type { AgentChatBlock } from "@planner/shared/src/chat/agent-chat-block-schema.ts";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import { invertCommand } from "@planner/shared/src/commands/invert-command.ts";
import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { ChatSendResult } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import type { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import type { AgentEvent } from "../agent/stream-json.ts";
import { unfurlLinkBlock } from "../links/unfurl-link-block.ts";
import { getChatPhotos } from "../photos/get-chat-photos.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import type { Logger } from "../util/logger.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import { buildNewSessionPrompt } from "./build-new-session-prompt.ts";
import type { ChatStore } from "./create-chat-store.ts";
import { createTurnSlots } from "./create-turn-slots.ts";
import { describeSceneChanges } from "./describe-scene-changes.ts";

const TOOL_PREFIX = "mcp__planner__";
const DESIGNER_TOOLS = ROLE_TOOLS.designer.map(
  (name) => `${TOOL_PREFIX}${name}`,
);

type ActiveTurn = {
  turnId: string;
  messageId: string;
  controller: AbortController;
};

/** Run `designer` agent turns for chat messages and turn their events into chat blocks. */
export const ATTACHED_PHOTOS_HEADING =
  "Attached photo files (inspect each image; use Read when images are not attached directly):";

export function createDesignerChat(options: {
  store: ProjectStore;
  chat: ChatStore;
  runtime: ReturnType<typeof createAgentRuntime>;
  config: () => Config;
  link: () => { wsUrl: string; token: string };
  rolePromptPath: string;
  logger: Logger;
  maxConcurrentTurns: number;
  slots?: ReturnType<typeof createTurnSlots>;
  env: NodeJS.ProcessEnv;
  linkAllowedHosts: string[];
}) {
  const active: { [projectId: string]: ActiveTurn } = Object.create(null);
  const slots =
    options.slots ?? createTurnSlots({ size: options.maxConcurrentTurns });

  function activeTurn(input: { projectId: string; turnId: string }) {
    const turn = Object.hasOwn(active, input.projectId)
      ? active[input.projectId]
      : undefined;
    if (turn?.turnId !== input.turnId || turn.controller.signal.aborted)
      throw new Error("This agent turn is not running");
    return turn;
  }

  function addNotice(input: {
    projectId: string;
    messageId: string;
    block: Extract<ChatBlock, { kind: "notice" }>;
  }) {
    options.chat.appendBlock(input);
  }

  function missingCliNotice(cli: "claude" | "codex") {
    const name = cli === "claude" ? "Claude Code" : "Codex";
    return {
      kind: "notice",
      text: `${name} is not installed on this Mac. Install it, then check again in Settings.`,
      detail: {
        kind: "missing-requirement",
        settingsSection: "agents",
        setupFeature: cli,
      },
    } satisfies ChatBlock;
  }

  function cliPath(cli: "claude" | "codex") {
    return resolveExecutable({
      env: options.env,
      command:
        (cli === "claude"
          ? options.env.PLANNER_CLAUDE_BIN
          : options.env.PLANNER_CODEX_BIN) ?? cli,
    });
  }

  function isCliInstalled(cli: "claude" | "codex") {
    try {
      accessSync(cliPath(cli), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  function unfurl(input: {
    projectId: string;
    messageId: string;
    blockIndex: number;
    block: Extract<ChatBlock, { kind: "link" }>;
  }) {
    unfurlLinkBlock({
      block: input.block,
      projectFolder: options.store.projectPath(input.projectId),
      allowedHosts: options.linkAllowedHosts,
      logWarning: options.logger.warn,
    })
      .then((block) => {
        if (block !== input.block) options.chat.setBlock({ ...input, block });
      })
      .catch((error: unknown) =>
        options.logger.warn(`link preview failed: ${String(error)}`),
      );
  }

  async function runTurn(input: {
    projectId: string;
    text: string;
    imagePaths: string[];
    newSessionPrompt: string | undefined;
    turn: ActiveTurn;
  }) {
    const { projectId, turn } = input;
    const messageId = turn.messageId;
    const projectFolder = options.store.projectPath(projectId);
    const mcpDir = join(
      projectFolder,
      ".planner",
      "sessions",
      `turn-${turn.turnId}`,
    );
    const toolBlocks: {
      [toolCallId: string]: {
        blockIndex: number;
        startedAtMs: number;
        block: Extract<ChatBlock, { kind: "tool" }>;
      };
    } = {};

    function onEvent(event: AgentEvent) {
      if (event.kind === "assistant_text") {
        options.chat.appendText({ projectId, messageId, text: event.text });
        return;
      }
      if (event.kind === "tool_use") {
        const name = event.name.startsWith(PLANNER_TOOL_PREFIX)
          ? event.name.slice(PLANNER_TOOL_PREFIX.length)
          : event.name;
        const commandType =
          typeof event.input === "object" &&
          event.input !== null &&
          "command" in event.input &&
          typeof event.input.command === "object" &&
          event.input.command !== null &&
          "type" in event.input.command &&
          typeof event.input.command.type === "string"
            ? event.input.command.type
            : undefined;
        const block = {
          kind: "tool",
          toolCallId: event.id || randomUUID(),
          name,
          summary: commandType ?? "",
          status: "running",
          arguments: event.input,
        } satisfies ChatBlock;
        toolBlocks[block.toolCallId] = {
          blockIndex: options.chat.appendBlock({ projectId, messageId, block }),
          startedAtMs: Date.now(),
          block,
        };
        return;
      }
      if (event.kind === "tool_result" && event.toolUseId !== undefined) {
        const tool = Object.hasOwn(toolBlocks, event.toolUseId)
          ? toolBlocks[event.toolUseId]
          : undefined;
        if (tool === undefined) return;
        tool.block = {
          ...tool.block,
          status: event.isError ? "failed" : "done",
          durationMs: Date.now() - tool.startedAtMs,
          result: event.preview,
        };
        options.chat.setBlock({
          projectId,
          messageId,
          blockIndex: tool.blockIndex,
          block: tool.block,
        });
      }
    }

    function finish(status: "done" | "failed" | "stopped") {
      for (const tool of Object.values(toolBlocks))
        if (tool.block.status === "running")
          options.chat.setBlock({
            projectId,
            messageId,
            blockIndex: tool.blockIndex,
            block: { ...tool.block, status: "failed" },
          });
      options.chat.finish({ projectId, messageId, status });
    }

    const release = await slots.acquire(turn.controller.signal);
    try {
      if (release === undefined) {
        finish("stopped");
        return;
      }
      const role = options.config().roles.designer;
      if (!isCliInstalled(role.cli)) {
        addNotice({ projectId, messageId, block: missingCliNotice(role.cli) });
        finish("failed");
        return;
      }
      const link = options.link();
      const mcpConfigPath = writeMcpConfig({
        projectId,
        turnId: turn.turnId,
        role: "designer",
        allowedTools: DESIGNER_TOOLS,
        token: link.token,
        wsUrl: link.wsUrl,
        dir: mcpDir,
      });
      const result = await options.runtime.runTurn({
        project: projectFolder,
        session: { role: "designer", cli: role.cli },
        model: role.model,
        systemPrompt: readFileSync(options.rolePromptPath, "utf8"),
        prompt: input.text,
        newSessionPrompt: input.newSessionPrompt,
        mcpConfigPath,
        allowedTools:
          role.cli === "claude"
            ? [...DESIGNER_TOOLS, "Read", "WebSearch", "WebFetch"]
            : [...DESIGNER_TOOLS, "WebSearch"],
        imagePaths: role.cli === "codex" ? input.imagePaths : [],
        readableDirs: existsSync(join(projectFolder, "photos", "vision"))
          ? [join(projectFolder, "photos", "vision")]
          : [],
        extraEnv: {
          PLANNER_READ_ROOT: join(projectFolder, "photos", "vision"),
        },
        readOnly: true,
        signal: turn.controller.signal,
        onEvent,
      });
      if (result.interrupted) {
        finish("stopped");
        return;
      }
      if (result.usageLimit) {
        addNotice({
          projectId,
          messageId,
          block: {
            kind: "notice",
            text: result.usageLimit.message || "The usage limit was reached.",
            detail: {
              kind: "usage-limit",
              ...(result.usageLimit.resetsAt
                ? { resetAt: result.usageLimit.resetsAt }
                : {}),
            },
          },
        });
        finish("failed");
        return;
      }
      if (result.isError) {
        addNotice({
          projectId,
          messageId,
          block: {
            kind: "notice",
            text:
              result.stopReason === "timeout"
                ? "The agent stopped answering and was stopped after 15 minutes."
                : result.finalText.trim() || "The agent turn failed.",
            detail: { kind: "error" },
          },
        });
        finish("failed");
        return;
      }
      finish("done");
    } catch (error) {
      options.logger.error(`designer turn failed: ${String(error)}`);
      addNotice({
        projectId,
        messageId,
        block: {
          kind: "notice",
          text: error instanceof Error ? error.message : String(error),
          detail: { kind: "error" },
        },
      });
      finish("failed");
    } finally {
      release?.();
      rmSync(mcpDir, { recursive: true, force: true });
      if (active[projectId]?.turnId === turn.turnId) delete active[projectId];
    }
  }

  return {
    requireTurn: activeTurn,
    send(input: {
      projectId: string;
      text?: string | undefined;
      photoIds?: string[] | undefined;
      itemIds?: string[] | undefined;
    }): ChatSendResult {
      const project = options.store.loadProject(input.projectId);
      const items = [...new Set(input.itemIds ?? [])].map((itemId) => {
        const item = project.scene.items.find((item) => item.id === itemId);
        if (!item) throw new Error(`Unknown item in this project: ${itemId}`);
        return {
          kind: "item",
          itemId,
          name: item.name,
          ...(item.model.kind === "asset"
            ? { assetId: item.model.assetId }
            : {}),
        } satisfies ChatBlock;
      });
      if (Object.hasOwn(active, input.projectId))
        throw new Error("The designer is still answering in this project");
      const photos = getChatPhotos({
        projectFolder: options.store.projectPath(input.projectId),
        photoIds: input.photoIds ?? [],
      });
      const text = [
        input.text ??
          "The user sent photos without text. Inspect them, then use chat_post to ask whether to add the object in the photo or use it as a reference for the selected object. Return a choice block with those two options.",
        ...(items.length > 0
          ? [
              "Referenced items (act on these IDs):",
              JSON.stringify(
                items.map((item) => ({ itemId: item.itemId, name: item.name })),
              ),
            ]
          : []),
        ...(photos.length > 0
          ? [
              ATTACHED_PHOTOS_HEADING,
              JSON.stringify(photos.map((photo) => photo.path)),
            ]
          : []),
      ].join("\n");
      const newSessionPrompt = buildNewSessionPrompt({
        history: options.chat.list(input.projectId),
        text,
      });
      const createdAt = new Date().toISOString();
      const userMessageId = randomUUID();
      const agentMessageId = randomUUID();
      options.chat.add({
        projectId: input.projectId,
        message: {
          id: userMessageId,
          author: { kind: "user" },
          blocks: [
            ...items,
            ...photos.map((photo) => photo.block),
            ...(input.text === undefined
              ? []
              : [{ kind: "text", markdown: input.text } satisfies ChatBlock]),
          ],
          status: "done",
          createdAt,
        },
      });
      options.chat.add({
        projectId: input.projectId,
        message: {
          id: agentMessageId,
          author: { kind: "agent", role: "designer" },
          blocks: [],
          status: "streaming",
          createdAt,
        },
      });
      const turn = {
        turnId: randomUUID(),
        messageId: agentMessageId,
        controller: new AbortController(),
      };
      active[input.projectId] = turn;
      runTurn({
        projectId: input.projectId,
        text,
        imagePaths: photos.map((photo) => photo.path),
        newSessionPrompt,
        turn,
      }).catch((error: unknown) =>
        options.logger.error(`designer turn failed: ${String(error)}`),
      );
      return { userMessageId, agentMessageId };
    },
    stop(projectId: string) {
      const turn = Object.hasOwn(active, projectId)
        ? active[projectId]
        : undefined;
      turn?.controller.abort();
      return { stopped: turn !== undefined };
    },
    stopAll() {
      for (const turn of Object.values(active)) turn.controller.abort();
    },
    applySceneCommand(input: {
      projectId: string;
      turnId: string;
      command: Command;
    }) {
      const turn = activeTurn(input);
      const before = options.store.loadProject(input.projectId).scene;
      const result = options.store.applyCommand({
        projectId: input.projectId,
        command: input.command,
        requestId: undefined,
      });
      const after = options.store.loadProject(input.projectId).scene;
      const undo = invertCommand({ scene: before, command: input.command });
      const changes = describeSceneChanges({ before, after });
      options.chat.appendBlock({
        projectId: input.projectId,
        messageId: turn.messageId,
        block: {
          kind: "diff",
          changes:
            changes.length > 0
              ? changes
              : [{ label: input.command.type, before: "", after: "no change" }],
          undo: undo === undefined ? [] : [undo],
        },
      });
      return result;
    },
    postBlocks(input: {
      projectId: string;
      turnId: string;
      blocks: AgentChatBlock[];
    }) {
      const turn = activeTurn(input);
      for (const block of input.blocks) {
        const blockIndex = options.chat.appendBlock({
          projectId: input.projectId,
          messageId: turn.messageId,
          block,
        });
        if (block.kind === "link")
          unfurl({
            projectId: input.projectId,
            messageId: turn.messageId,
            blockIndex,
            block,
          });
      }
      return { posted: input.blocks.length };
    },
  };
}
