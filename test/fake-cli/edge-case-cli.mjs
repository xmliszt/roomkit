#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const codex = args.at(0) === "exec";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const resumed = codex ? args.at(1) === "resume" : args.includes("--resume");
const sessionId = resumed
  ? args.at(codex ? 2 : args.indexOf("--resume") + 1)
  : codex
    ? randomUUID()
    : args.at(args.indexOf("--session-id") + 1);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
if (prompt === "missing-session-stderr" && resumed) {
  emit({ type: "turn.failed", error: { message: "Could not resume session" } });
  process.stderr.write(
    `thread/resume failed: no rollout found for thread ${sessionId}\n`,
  );
  process.exit(1);
}
const costPath = join(process.cwd(), "fake-cost.json");
const invocation = existsSync(costPath)
  ? Number(readFileSync(costPath, "utf8")) + 1
  : 1;
if (prompt === "cost") {
  writeFileSync(costPath, String(invocation));
  if (invocation === 2) {
    process.stderr.write("No conversation found with session ID\n");
    process.exit(1);
  }
}
if (prompt === "orphan") {
  const descendant = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},1000)',
    ],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  await new Promise((resolve) => descendant.once("message", resolve));
  writeFileSync(join(process.cwd(), "descendant.pid"), String(descendant.pid));
  descendant.disconnect();
  descendant.unref();
}
emit(
  codex
    ? { type: "thread.started", thread_id: sessionId }
    : {
        type: "system",
        subtype: "init",
        session_id: sessionId,
        model: "fake",
        tools: [],
      },
);
if (prompt === "orphan") await delay(20000);
if (prompt === "stderr-warning")
  process.stderr.write("warning: optional service unavailable");
if (prompt === "split-token") {
  const token = process.env.PLANNER_TOKEN ?? "";
  process.stderr.write(token.slice(0, 6));
  await delay(30);
  process.stderr.write(token.slice(6));
  process.exitCode = 1;
} else {
  if (prompt === "recovered")
    emit({ type: "error", message: "Reconnecting... 1/5" });
  if (prompt.includes("rate-limit"))
    emit({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1900000000 },
    });
  if (prompt.startsWith("rate-limit-no-result")) {
    process.exitCode = prompt.endsWith("error") ? 1 : 0;
  } else if (
    prompt === "rate-limit-failed-result" ||
    prompt === "rate-limit-text-error"
  ) {
    emit({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result:
        prompt === "rate-limit-text-error"
          ? "Rate limit exceeded"
          : "Request rejected",
      session_id: sessionId,
    });
  } else {
    const text =
      prompt === "quoted-error"
        ? "No conversation found with session ID is an example error"
        : prompt === "token"
          ? process.env.PLANNER_TOKEN
          : "done";
    emit(
      codex
        ? {
            type: "item.completed",
            item: { id: "text", type: "agent_message", text },
          }
        : { type: "assistant", message: { content: [{ type: "text", text }] } },
    );
    emit(
      codex
        ? {
            type: "turn.completed",
            usage: { input_tokens: 100, output_tokens: 20 },
          }
        : {
            type: "result",
            subtype: "success",
            is_error: false,
            stop_reason: "end_turn",
            session_id: sessionId,
            result: text,
            num_turns: 1,
            total_cost_usd:
              prompt === "cost"
                ? invocation === 1
                  ? 5
                  : invocation - 2
                : 0.01,
            usage: { input_tokens: 100, output_tokens: 20 },
          },
    );
  }
}
