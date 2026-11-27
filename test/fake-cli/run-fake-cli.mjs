import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createMcpClient } from "./create-mcp-client.mjs";
import { parseTomlValue } from "./parse-toml-value.mjs";

export async function runFakeCli({
  kind,
  prompt: providedPrompt,
  scenario: providedScenario,
}) {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(`fake-${kind} 0.0.1\n`);
    return;
  }
  if (args.includes("--help")) {
    process.stdout.write(
      "exec --json --ignore-user-config --dangerously-bypass-hook-trust\n",
    );
    return;
  }
  if (args.at(0) === "auth" || args.at(0) === "login") {
    process.stdout.write(
      kind === "claude" ? '{"loggedIn":true}\n' : "Logged in using ChatGPT\n",
    );
    return;
  }
  if (
    kind === "codex" &&
    !args.includes("--skip-git-repo-check") &&
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      stdio: "ignore",
    }).status !== 0
  ) {
    process.stderr.write(
      "Not inside a trusted directory and --skip-git-repo-check was not specified.\n",
    );
    process.exitCode = 1;
    return;
  }
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args.at(index + 1);
  };
  const resumeId =
    kind === "claude"
      ? value("--resume")
      : args.at(1) === "resume"
        ? args.at(2)
        : undefined;
  const sessionId = resumeId ?? value("--session-id") ?? randomUUID();
  const model = value("--model") ?? `fake-${kind}`;
  if (process.env.FAKE_MODEL_PROBE_LOG)
    appendFileSync(
      process.env.FAKE_MODEL_PROBE_LOG,
      `${JSON.stringify({ cli: kind, model, maxBudgetUsd: value("--max-budget-usd") })}\n`,
    );
  if (
    [
      "fake-invalid-model",
      "claude-invalid-model",
      "gpt-invalid-model",
    ].includes(model)
  ) {
    process.stderr.write(`Unknown model: ${model}\n`);
    process.exitCode = 1;
    return;
  }
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  let client;
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await client?.close();
    process.exit(143);
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  };
  const codexSessions = join(
    process.env.CODEX_HOME ??
      process.env.PLANNER_HOME ??
      join(process.cwd(), ".planner"),
    "fake-sessions",
  );
  const codexSessionPath = join(codexSessions, `${sessionId}.json`);
  let completedTurns = 0;
  function result({ text, error = false }) {
    if (kind === "claude") {
      emit({
        type: "result",
        subtype: error ? "error_during_execution" : "success",
        is_error: error,
        stop_reason: error ? "agent_error" : "end_turn",
        result: text,
        session_id: sessionId,
        total_cost_usd: 0.01,
        usage,
        num_turns: 1,
      });
    } else if (error) emit({ type: "turn.failed", error: { message: text } });
    else {
      completedTurns += 1;
      writeFileSync(
        codexSessionPath,
        JSON.stringify({ sessionId, completedTurns }),
      );
      emit({
        type: "turn.completed",
        usage: {
          input_tokens: 110 * completedTurns,
          output_tokens: 20 * completedTurns,
          cached_input_tokens: 10 * completedTurns,
        },
      });
    }
  }
  try {
    if (kind === "claude" && !args.includes("-p"))
      throw new Error("Expected -p with the prompt on stdin");
    let prompt = providedPrompt ?? "";
    if (providedPrompt === undefined)
      for await (const chunk of process.stdin) prompt += chunk.toString();
    if (model === "claude-slow-probe") await delay(150);
    if (model === "claude-hanging-probe" || model === "gpt-hanging-probe") {
      if (process.env.FAKE_MODEL_PROBE_PID)
        writeFileSync(process.env.FAKE_MODEL_PROBE_PID, String(process.pid));
      await delay(60000);
    }
    let server;
    if (kind === "claude") {
      if (value("--output-format") !== "stream-json")
        throw new Error("Expected --output-format stream-json");
      const mcpPath = value("--mcp-config");
      if (mcpPath)
        server = JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers?.planner;
      const settingsPath = value("--settings");
      if (settingsPath) JSON.parse(readFileSync(settingsPath, "utf8"));
    } else {
      if (
        args.at(0) !== "exec" ||
        !args.includes("--json") ||
        args.at(-1) !== "-"
      ) {
        throw new Error("Expected exec --json and prompt on stdin");
      }
      for (const [index, arg] of args.entries()) {
        if (arg !== "-c") continue;
        const config = args.at(index + 1) ?? "";
        const separator = config.indexOf("=");
        const key = config.slice(0, separator);
        const parsed = parseTomlValue(config.slice(separator + 1));
        if (key === "mcp_servers.planner") server = parsed;
        if (key === "mcp_servers") server = parsed.planner;
      }
    }
    const selected =
      (model === "claude-no-probe" ? "echo" : undefined) ??
      (model === "fake-inventory-openings"
        ? "inventory-openings"
        : undefined) ??
      (model === "fake-inventory" ? "inventory" : undefined) ??
      (model === "fake-surfaces" ? "surfaces" : undefined) ??
      (server?.env?.PLANNER_ROLE === "modeler" ? "generation" : undefined) ??
      /\[fake:([a-zA-Z0-9_-]+)\]/.exec(prompt)?.at(1) ??
      (server?.env?.PLANNER_ROLE === "surveyor"
        ? "inventory-empty"
        : undefined) ??
      (prompt.includes("Attached photo files (inspect each image;")
        ? "photo-choice"
        : undefined) ??
      (prompt.trimEnd().endsWith("change the chair to orange")
        ? "recolor-chair"
        : undefined) ??
      process.env.PLANNER_FAKE_SCENARIO ??
      "echo";
    const path = new URL(
      `./scenarios/${encodeURIComponent(selected)}.mjs`,
      import.meta.url,
    );
    const scenario =
      providedScenario ??
      (existsSync(fileURLToPath(path))
        ? await import(path.href)
        : await import("./scenarios/echo.mjs"));
    if (scenario.ignoreSigterm) {
      process.removeListener("SIGTERM", stop);
      process.on("SIGTERM", () => undefined);
    }
    if (selected === "missing-session" && resumeId) {
      const text =
        kind === "claude"
          ? `No conversation found with session ID: ${sessionId}`
          : `no rollout found for thread ${sessionId}`;
      process.stderr.write(`${text}\n`);
      process.exitCode = 1;
      return;
    }
    if (scenario.initDelayMs) await delay(scenario.initDelayMs);
    if (kind === "codex") {
      mkdirSync(codexSessions, { recursive: true });
      if (resumeId && !existsSync(codexSessionPath))
        throw new Error(`no rollout found for thread ${sessionId}`);
      completedTurns = resumeId
        ? (JSON.parse(readFileSync(codexSessionPath, "utf8")).completedTurns ??
          0)
        : 0;
      writeFileSync(
        codexSessionPath,
        JSON.stringify({
          sessionId,
          ...(completedTurns ? { completedTurns } : {}),
        }),
      );
    }
    emit(
      kind === "claude"
        ? {
            type: "system",
            subtype: "init",
            session_id: sessionId,
            model,
            tools: [],
            pid: process.pid,
          }
        : { type: "thread.started", thread_id: sessionId, pid: process.pid },
    );
    let text = "";
    let error = false;
    const results = {};
    for (const step of typeof scenario.steps === "function"
      ? scenario.steps({ prompt, resumeId })
      : scenario.steps) {
      if (step.kind === "sleep") await delay(step.durationMs);
      else if (step.kind === "text") {
        text = step.text;
        emit(
          kind === "claude"
            ? {
                type: "assistant",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text }],
                },
              }
            : {
                type: "item.completed",
                item: { id: randomUUID(), type: "agent_message", text },
              },
        );
      } else if (step.kind === "error") {
        error = true;
        text = step.message;
        if (kind === "claude" && /usage limit/i.test(text)) {
          emit({
            type: "rate_limit_event",
            rate_limit_info: { status: "rejected", resetsAt: 1900000000 },
          });
        }
        break;
      } else if (step.kind === "tool") {
        client ??= await createMcpClient(server);
        const args =
          typeof step.arguments === "function"
            ? step.arguments(results)
            : (step.arguments ?? {});
        const id = randomUUID();
        const item = {
          id,
          type: "mcp_tool_call",
          server: "planner",
          tool: step.name,
          arguments: args,
        };
        emit(
          kind === "claude"
            ? {
                type: "assistant",
                message: {
                  content: [
                    {
                      type: "tool_use",
                      id,
                      name: `mcp__planner__${step.name}`,
                      input: args,
                    },
                  ],
                },
              }
            : { type: "item.started", item },
        );
        const response = await client.call({ ...step, arguments: args });
        if (!response.isError && response.content.at(0)?.type === "text")
          results[step.name] = JSON.parse(response.content.at(0).text);
        emit(
          kind === "claude"
            ? {
                type: "user",
                message: {
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: id,
                      is_error: response.isError === true,
                      content: response.content,
                    },
                  ],
                },
              }
            : {
                type: "item.completed",
                item: {
                  ...item,
                  status: response.isError ? "failed" : "completed",
                  result: response,
                },
              },
        );
        if (response.isError) throw new Error(response.content.at(0).text);
      } else throw new Error(`Unknown fake scenario step: ${step.kind}`);
    }
    result({ text, error });
    if (error) process.exitCode = 1;
  } catch (error) {
    result({
      text: error instanceof Error ? error.message : String(error),
      error: true,
    });
    process.exitCode = 1;
  } finally {
    await client?.close();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
