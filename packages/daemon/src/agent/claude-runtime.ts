import { createProcessRuntime } from "./create-process-runtime.ts";
import type { TaskRunOptions } from "./run-options.ts";
import { decodeLine } from "./stream-json.ts";

export type { AgentRunResult } from "./run-options.ts";

export class ClaudeRuntime {
  private readonly runtime: ReturnType<typeof createProcessRuntime>;

  constructor(
    options: {
      timeoutMs?: number;
      killGraceMs?: number;
      startupGraceMs?: number;
    } = {},
  ) {
    this.runtime = createProcessRuntime({
      ...options,
      buildArgs: (input) => this.buildArgs(input),
      decode: ({ line }) => decodeLine(line),
    });
  }

  buildArgs(options: TaskRunOptions) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      options.model,
      "--append-system-prompt",
      options.appendSystemPrompt,
      "--allowedTools",
      (options.allowedTools ?? []).join(","),
      "--permission-mode",
      "acceptEdits",
      options.resume ? "--resume" : "--session-id",
      options.sessionId,
    ];
    if (options.env?.PLANNER_READ_ONLY === "1")
      args.push(
        "--tools",
        (options.allowedTools ?? [])
          .filter((tool) => !tool.startsWith("mcp__"))
          .join(","),
        "--disallowedTools",
        "Edit,Write,MultiEdit,NotebookEdit,Bash",
      );
    if (options.effort !== undefined) args.push("--effort", options.effort);
    if (options.settingsPath) args.push("--settings", options.settingsPath);
    if (options.maxTurns !== undefined && options.maxTurns > 0)
      args.push("--max-turns", String(options.maxTurns));
    for (const dir of options.readableDirs ?? []) args.push("--add-dir", dir);
    if (options.mcpConfigPath) args.push("--mcp-config", options.mcpConfigPath);
    args.push("--strict-mcp-config");
    return args;
  }

  run(options: TaskRunOptions) {
    return this.runtime.run(options);
  }
  interrupt(key: string) {
    return this.runtime.interrupt(key);
  }
  killAll() {
    this.runtime.killAll();
  }
}
