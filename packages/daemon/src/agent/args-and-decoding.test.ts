import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { buildCodexArgs } from "./build-codex-args.ts";
import { ClaudeRuntime } from "./claude-runtime.ts";
import { decodeCodexEvent } from "./decode-codex-event.ts";
import { HOOK_SCRIPT_PATH } from "./hooks.ts";
import { readUsageLimit } from "./read-usage-limit.ts";
import type { TaskRunOptions } from "./run-options.ts";
import { decodeLine } from "./stream-json.ts";

it("matches the full Claude argv for a new and resumed turn, with the prompt left for stdin", () => {
  const runtime = new ClaudeRuntime();
  const input: TaskRunOptions = {
    cli: "claude",
    sessionId: "fake-id",
    resume: false,
    cwd: ".",
    model: "fake-model",
    effort: "high",
    appendSystemPrompt: "role",
    prompt: "prompt",
    transcriptPath: "unused",
    settingsPath: "hooks.json",
    mcpConfigPath: "planner-mcp.json",
    allowedTools: ["Read", "mcp__planner__*"],
    maxTurns: 4,
  };
  const expected = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "fake-model",
    "--append-system-prompt",
    "role",
    "--allowedTools",
    "Read,mcp__planner__*",
    "--permission-mode",
    "acceptEdits",
    "--session-id",
    "fake-id",
    "--effort",
    "high",
    "--settings",
    "hooks.json",
    "--max-turns",
    "4",
    "--mcp-config",
    "planner-mcp.json",
    "--strict-mcp-config",
  ];
  expect(runtime.buildArgs(input)).toEqual(expected);
  expect(runtime.buildArgs({ ...input, resume: true })).toEqual(
    expected.map((arg) => (arg === "--session-id" ? "--resume" : arg)),
  );
});

it("matches the full Codex argv with isolated MCP and stdin prompt", () => {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/agent-args-"));
  try {
    const mcpConfigPath = join(root, "planner-mcp.json");
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          planner: {
            command: "node",
            args: ["server.ts"],
            env: { PLANNER_TOKEN: "fake-token" },
          },
        },
      }),
    );
    const input: TaskRunOptions = {
      cli: "codex",
      sessionId: "fake-thread",
      resume: false,
      cwd: root,
      model: "fake-model",
      effort: "max",
      appendSystemPrompt: "role",
      prompt: "prompt",
      transcriptPath: "unused",
      mcpConfigPath,
    };
    const common = [
      "--json",
      "--ignore-user-config",
      "--dangerously-bypass-hook-trust",
      "--skip-git-repo-check",
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      'developer_instructions="role"',
      "-c",
      'mcp_servers.planner={ "command" = "node", "args" = ["server.ts"], "env" = { "PLANNER_TOKEN" = "fake-token" }, "required" = true, "default_tools_approval_mode" = "approve", "tool_timeout_sec" = 900 }',
      "-c",
      `hooks={ "PreToolUse" = [{ "matcher" = ".*", "hooks" = [{ "type" = "command", "command" = "'${process.execPath}' '${HOOK_SCRIPT_PATH}'" }] }] }`,
      "-c",
      "features.hooks=true",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.apps=false",
      "-c",
      'web_search="live"',
      "-c",
      'model_reasoning_effort="xhigh"',
      "--model",
      "fake-model",
      "-",
    ];
    expect(buildCodexArgs(input)).toEqual(["exec", ...common]);
    expect(
      buildCodexArgs({ ...input, allowedTools: ["mcp__planner__*"] }),
    ).toContain('web_search="disabled"');
    expect(buildCodexArgs({ ...input, resume: true })).toEqual([
      "exec",
      "resume",
      "fake-thread",
      ...common,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("decodes Claude usage, thinking, text, tool pairs, result and rate limit fixtures", () => {
  const decode = (value: unknown) => decodeLine(JSON.stringify(value));
  expect(
    decode({
      type: "system",
      subtype: "init",
      session_id: "fake-id",
      model: "fake",
      tools: ["Read"],
    }),
  ).toEqual([
    { kind: "init", sessionId: "fake-id", model: "fake", tools: ["Read"] },
  ]);
  expect(
    decode({
      type: "assistant",
      message: {
        id: "message",
        model: "fake",
        usage: { input_tokens: 5, output_tokens: 2 },
        content: [
          { type: "thinking", thinking: "think" },
          { type: "text", text: "hello" },
          {
            type: "tool_use",
            id: "call",
            name: "Read",
            input: { path: "file" },
          },
        ],
      },
    }).map((event) => event.kind),
  ).toEqual(["turn_usage", "thinking", "assistant_text", "tool_use"]);
  expect(
    decode({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "call", content: "done" },
        ],
      },
    }),
  ).toEqual([
    { kind: "tool_result", toolUseId: "call", isError: false, preview: "done" },
  ]);
  expect(
    decode({
      type: "result",
      subtype: "success",
      session_id: "fake-id",
      total_cost_usd: 0.1,
      num_turns: 1,
      usage: { input_tokens: 5, output_tokens: 2 },
    }).at(0),
  ).toMatchObject({
    kind: "result",
    sessionCostUsd: 0.1,
    usage: { inputTokens: 5, outputTokens: 2 },
  });
  expect(
    decode({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected" },
    }).at(0)?.kind,
  ).toBe("rate_limit");
  expect(decodeLine("broken")).toEqual([]);
});

it("decodes Codex token usage and tool fixtures", () => {
  const decode = (value: unknown) =>
    decodeCodexEvent({ line: JSON.stringify(value), model: "fake" });
  expect(
    decode({ type: "thread.started", thread_id: "thread" }).at(0),
  ).toMatchObject({ kind: "init", sessionId: "thread" });
  expect(
    decode({
      type: "turn.completed",
      usage: { input_tokens: 20, cached_input_tokens: 4, output_tokens: 5 },
    }).at(0),
  ).toMatchObject({
    kind: "turn_usage",
    usage: { inputTokens: 16, cacheRead: 4, outputTokens: 5 },
  });
  expect(
    decode({
      type: "item.started",
      item: { id: "tool", type: "command_execution", command: "pwd" },
    }).at(0),
  ).toMatchObject({ kind: "tool_use", name: "Bash" });
  expect(
    decode({
      type: "item.completed",
      item: {
        id: "tool",
        type: "command_execution",
        exit_code: 1,
        aggregated_output: "failed",
      },
    }).at(0),
  ).toMatchObject({ kind: "tool_result", isError: true });
  expect(
    decode({ type: "turn.failed", error: { message: "failed" } }).at(0),
  ).toMatchObject({ kind: "result", isError: true });
  expect(
    decode({
      type: "item.completed",
      item: { id: "text", type: "agent_message", text: "hello" },
    }).at(0),
  ).toEqual({ kind: "assistant_text", text: "hello" });
});

it("detects rejected limits with seconds, milliseconds, and ISO reset times", () => {
  const resetsAt = "2026-11-06T00:00:00.000Z";
  const ms = Date.parse(resetsAt);
  for (const raw of [ms, ms / 1000, resetsAt])
    expect(
      readUsageLimit({ info: { status: "rejected", resetsAt: raw } })?.resetsAt,
    ).toBe(resetsAt);
  expect(
    readUsageLimit({ text: `Claude AI usage limit reached|${ms / 1000}` })
      ?.resetsAt,
  ).toBe(resetsAt);
  expect(readUsageLimit({ info: { status: "allowed" } })).toBeUndefined();
});
