import type { AgentEvent, AgentUsage } from "./stream-json.ts";

export type AgentRunResult = {
  sessionId: string | undefined;
  isError: boolean;
  stopReason: string | undefined;
  finalText: string;
  costUsd: number | undefined;
  sessionCostUsd: number | undefined;
  usage: AgentUsage;
  numTurns: number;
  toolUses: number;
  abortedByBudget: boolean;
  interrupted: boolean;
  usageLimit?: { resetsAt: string | undefined; message: string };
};

export type TaskRunOptions = {
  cli: "claude" | "codex";
  sessionId: string;
  resume: boolean;
  cwd: string;
  model: string;
  rates?: { input: number; output: number } | undefined;
  effort?: string;
  appendSystemPrompt: string;
  prompt: string;
  imagePaths?: string[];
  newSessionPrompt?: string | undefined;
  transcriptPath: string;
  settingsPath?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
  maxTurns?: number;
  readableDirs?: string[];
  subscribeToJobProgress?: (onProgress: () => void) => () => void;
  onUsage?: (input: {
    usage: AgentUsage;
    sessionId: string | undefined;
    sessionCostUsd: number | undefined;
    costUsd: number | undefined;
  }) => void;
  interruptKey?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  binary?: string;
  onEvent?: (event: AgentEvent) => void;
  onSpawn?: (pid: number) => void;
};
