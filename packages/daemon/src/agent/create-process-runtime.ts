import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createTokenScrubber } from "../util/create-token-scrubber.ts";
import { estimateCostUsd } from "../util/estimate-cost-usd.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";
import { readUsageLimit } from "./read-usage-limit.ts";
import type { AgentRunResult, TaskRunOptions } from "./run-options.ts";
import type { AgentEvent, AgentUsage } from "./stream-json.ts";

type RuntimeOptions = {
  buildArgs: (input: TaskRunOptions) => string[];
  decode: (options: { line: string; model: string }) => AgentEvent[];
  timeoutMs?: number;
  killGraceMs?: number;
  startupGraceMs?: number;
};

export function createProcessRuntime(options: RuntimeOptions) {
  const runs: { [key: string]: { stop: () => void; kill: () => void } } = {};

  function run(input: TaskRunOptions): Promise<AgentRunResult> {
    const key = input.interruptKey ?? input.sessionId;
    if (runs[key])
      throw new Error(`Agent session ${key} already has a running turn`);
    const args = options.buildArgs(input);
    const sourceEnv = input.env ?? process.env;
    const redact = createTokenScrubber(sourceEnv);
    mkdirSync(dirname(input.transcriptPath), { recursive: true });
    function write(value: unknown) {
      appendFileSync(input.transcriptPath, `${JSON.stringify(value)}\n`, {
        mode: 0o600,
      });
    }
    write({
      kind: "spawn",
      argv: args.map((arg) =>
        arg.startsWith("mcp_servers") ? "mcp_servers=<redacted>" : redact(arg),
      ),
      prompt: redact(input.prompt),
      resume: input.resume,
    });
    return new Promise((resolve) => {
      let sessionId = input.resume ? input.sessionId : undefined;
      let interrupted = false;
      let timedOut = false;
      let completed = false;
      let closing = false;
      let result: Extract<AgentEvent, { kind: "result" }> | undefined;
      let finalText = "";
      let failure = "";
      let stderr = "";
      let pending = "";
      let toolUses = 0;
      let usage: AgentUsage = {
        inputTokens: undefined,
        outputTokens: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      };
      const results: Extract<AgentEvent, { kind: "result" }>[] = [];
      let usageLimit: AgentRunResult["usageLimit"];
      const calls: { [key: string]: AgentUsage } = {};
      const child = spawn(
        input.binary ??
          (input.cli === "claude"
            ? sourceEnv.PLANNER_CLAUDE_BIN
            : sourceEnv.PLANNER_CODEX_BIN) ??
          input.cli,
        args,
        {
          cwd: input.cwd,
          env: scrubbedEnv({ env: sourceEnv }),
          detached: process.platform !== "win32",
        },
      );
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      let groupKilled = false;
      function signal(signal: NodeJS.Signals) {
        if (signal === "SIGKILL" && groupKilled) return;
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, signal);
          else child.kill(signal);
          if (signal === "SIGKILL") groupKilled = true;
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              (error.code === "ESRCH" || error.code === "EPERM")
            )
          )
            throw error;
        }
      }
      function terminate() {
        signal("SIGTERM");
        killTimer ??= setTimeout(
          () => signal("SIGKILL"),
          options.killGraceMs ?? 5000,
        );
      }
      function cancel() {
        if (sessionId) {
          clearTimeout(startupTimer);
          terminate();
          return;
        }
        startupTimer ??= setTimeout(terminate, options.startupGraceMs ?? 5000);
      }
      function interrupt() {
        interrupted = true;
        cancel();
      }
      runs[key] = { stop: interrupt, kill: () => signal("SIGKILL") };
      const timeoutMs =
        input.timeoutMs ??
        options.timeoutMs ??
        (Number(sourceEnv.PLANNER_AGENT_TIMEOUT_MS) || 900000);
      let lastActivityMs = Date.now();
      const timer = setInterval(
        () => {
          const nowMs = Date.now();
          if (nowMs - lastActivityMs >= timeoutMs) {
            clearInterval(timer);
            timedOut = true;
            cancel();
          }
        },
        Math.min(10000, timeoutMs / 4),
      );
      const unsubscribe = input.subscribeToJobProgress?.(() => {
        lastActivityMs = Date.now();
      });
      input.signal?.addEventListener("abort", interrupt, { once: true });
      if (input.signal?.aborted) interrupt();
      if (child.pid) {
        try {
          input.onSpawn?.(child.pid);
        } catch (error) {
          failure = redact(String(error));
          if (!closing) terminate();
        }
      }
      function emit(event: AgentEvent) {
        try {
          write(event);
          input.onEvent?.(event);
        } catch (error) {
          failure = redact(String(error));
          if (!closing) terminate();
        }
      }

      function reportedUsage() {
        if (input.cli === "codex" || results.length === 0) return usage;
        const sum = (field: keyof AgentUsage) =>
          results.reduce(
            (total, event) => total + (event.usage[field] ?? 0),
            0,
          ) + (usage[field] ?? 0);
        return {
          inputTokens: sum("inputTokens"),
          outputTokens: sum("outputTokens"),
          cacheRead: sum("cacheRead"),
          cacheWrite: sum("cacheWrite"),
        };
      }
      function reportedCost() {
        const pendingCostUsd =
          input.cli === "claude"
            ? estimateCostUsd({ usage, model: input.model, rates: input.rates })
            : 0;
        return {
          sessionCostUsd:
            result?.sessionCostUsd === undefined
              ? undefined
              : result.sessionCostUsd + pendingCostUsd,
          costUsd:
            input.cli === "claude" && result?.sessionCostUsd === undefined
              ? estimateCostUsd({
                  usage: reportedUsage(),
                  model: input.model,
                  rates: input.rates,
                })
              : undefined,
        };
      }
      function consume(line: string) {
        lastActivityMs = Date.now();
        const safeLine = (() => {
          try {
            return JSON.stringify(JSON.parse(line), (_key, value: unknown) =>
              typeof value === "string" ? redact(value) : value,
            );
          } catch {
            return redact(line);
          }
        })();
        try {
          write({ kind: "raw", line: safeLine });
        } catch (error) {
          failure = redact(String(error));
          if (!closing) terminate();
          return;
        }
        for (const event of options.decode({
          line: safeLine,
          model: input.model,
        })) {
          if (event.kind === "init" && event.sessionId) {
            sessionId = event.sessionId;
            if (interrupted || timedOut) cancel();
          }
          if (event.kind === "assistant_text") finalText = event.text;
          if (event.kind === "tool_use") toolUses += 1;
          if (event.kind === "turn_usage") {
            if (input.cli === "codex") {
              usage = event.usage;
              completed = true;
              result = undefined;
              usageLimit = undefined;
            } else {
              const isRepeat =
                event.messageId !== undefined &&
                JSON.stringify(calls[event.messageId]) ===
                  JSON.stringify(event.usage);
              if (isRepeat) continue;
              calls[event.messageId ?? `call-${Object.keys(calls).length}`] =
                event.usage;
              const sum = (field: keyof AgentUsage) =>
                Object.values(calls).reduce(
                  (total, item) => total + (item[field] ?? 0),
                  0,
                );
              usage = {
                inputTokens: sum("inputTokens"),
                outputTokens: sum("outputTokens"),
                cacheRead: sum("cacheRead"),
                cacheWrite: sum("cacheWrite"),
              };
            }
          }
          if (event.kind === "rate_limit")
            usageLimit = readUsageLimit({ info: event.info }) ?? usageLimit;
          if (event.kind === "result") {
            result = event;
            if (input.cli === "claude") {
              results.push(event);
              usage = {
                inputTokens: undefined,
                outputTokens: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              };
              for (const id of Object.keys(calls)) delete calls[id];
            }
            completed = !event.isError;
            if (event.sessionId) sessionId = event.sessionId;
            if (event.isError) {
              const textLimit = readUsageLimit({ text: event.finalText });
              if (textLimit)
                usageLimit = {
                  ...textLimit,
                  resetsAt: usageLimit?.resetsAt ?? textLimit.resetsAt,
                };
            } else usageLimit = undefined;
          }
          if (event.kind === "turn_usage" || event.kind === "result") {
            const reported = reportedUsage();
            try {
              input.onUsage?.({
                usage: reported,
                sessionId,
                ...reportedCost(),
              });
            } catch (error) {
              failure = redact(String(error));
              if (!closing) terminate();
            }
          }
          emit(event);
        }
      }
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        lastActivityMs = Date.now();
        pending += chunk;
        if (pending.length > 8000000) {
          failure = "Agent produced an oversized event";
          pending = "";
          terminate();
          return;
        }
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) consume(line);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        lastActivityMs = Date.now();
        stderr = (stderr + chunk).slice(-8000);
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(input.prompt);
      child.on("error", (error) => {
        failure = redact(error.message);
      });
      child.once("exit", () => signal("SIGKILL"));
      child.on("close", async (code) => {
        closing = true;
        if (pending.trim()) consume(pending);
        signal("SIGKILL");
        stderr = redact(stderr);
        if (stderr) {
          try {
            write({ kind: "stderr", line: stderr });
          } catch (error) {
            failure = redact(String(error));
          }
        }
        clearInterval(timer);
        unsubscribe?.();
        clearTimeout(killTimer);
        clearTimeout(startupTimer);
        input.signal?.removeEventListener("abort", interrupt);
        if (child.pid && process.platform !== "win32") {
          const deadlineMs = Date.now() + 1000;
          while (true) {
            try {
              process.kill(-child.pid, 0);
            } catch {
              break;
            }
            if (Date.now() >= deadlineMs) {
              failure = "Agent process group did not exit";
              break;
            }
            await delay(10);
          }
        }
        delete runs[key];
        const text =
          result?.finalText ||
          failure ||
          (completed ? finalText : stderr.trim() || finalText);
        const failed =
          timedOut || code !== 0 || !completed || !!failure || !!usageLimit;
        const sessionGone =
          !interrupted &&
          !timedOut &&
          failed &&
          input.resume &&
          /No conversation found with session ID|no rollout found for thread|thread\/resume failed/i.test(
            `${text}\n${stderr}`,
          );
        const isError = !interrupted && failed;
        const stopReason = interrupted
          ? "interrupted"
          : timedOut
            ? "timeout"
            : sessionGone
              ? "session_gone"
              : usageLimit
                ? "usage_limit"
                : isError
                  ? "agent_error"
                  : (result?.stopReason ?? "end_turn");
        const resolved: AgentRunResult = {
          sessionId: sessionGone ? undefined : sessionId,
          isError,
          stopReason,
          finalText: interrupted ? "" : text,
          ...reportedCost(),
          usage: reportedUsage(),
          numTurns:
            results.length > 0
              ? results.reduce((sum, event) => sum + event.numTurns, 0)
              : (result?.numTurns ?? (completed ? 1 : 0)),
          toolUses,
          abortedByBudget: false,
          interrupted,
          ...(usageLimit ? { usageLimit } : {}),
        };
        if (!result || input.cli === "codex")
          emit({
            kind: "result",
            subtype: isError ? "error" : "success",
            isError,
            stopReason,
            finalText: resolved.finalText,
            sessionId: resolved.sessionId,
            sessionCostUsd: resolved.sessionCostUsd,
            usage: resolved.usage,
            numTurns: resolved.numTurns,
          });
        resolve(
          failure
            ? {
                ...resolved,
                isError: true,
                stopReason: "agent_error",
                finalText: failure,
              }
            : resolved,
        );
      });
    });
  }
  return {
    run,
    interrupt(key: string) {
      const current = runs[key];
      current?.stop();
      return current !== undefined;
    },
    killAll() {
      for (const current of Object.values(runs)) current.kill();
    },
  };
}
