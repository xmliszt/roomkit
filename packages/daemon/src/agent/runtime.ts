import { randomUUID } from "node:crypto";
import { ClaudeRuntime } from "./claude-runtime.ts";
import { createCodexRuntime } from "./create-codex-runtime.ts";
import type { TaskRunOptions } from "./run-options.ts";

export type { TaskRunOptions } from "./run-options.ts";

export class RuntimeRouter {
  private readonly deps: {
    claude: ClaudeRuntime;
    codex: ReturnType<typeof createCodexRuntime>;
  };

  constructor(
    deps = { claude: new ClaudeRuntime(), codex: createCodexRuntime() },
  ) {
    this.deps = deps;
  }

  async run(options: TaskRunOptions) {
    const runtime = this.deps[options.cli];
    const attempt = await runtime.run(
      options.resume
        ? options
        : { ...options, prompt: options.newSessionPrompt ?? options.prompt },
    );
    if (
      attempt.stopReason !== "session_gone" ||
      !options.resume ||
      options.signal?.aborted
    )
      return attempt;
    return runtime.run({
      ...options,
      resume: false,
      sessionId: randomUUID(),
      prompt: options.newSessionPrompt ?? options.prompt,
    });
  }
  interrupt(key: string) {
    return this.deps.claude.interrupt(key) || this.deps.codex.interrupt(key);
  }
  killAll() {
    this.deps.claude.killAll();
    this.deps.codex.killAll();
  }
}
