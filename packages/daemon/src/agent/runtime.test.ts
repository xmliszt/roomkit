import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { exec } from "../util/exec.ts";
import { ClaudeRuntime } from "./claude-runtime.ts";
import { createAgentRuntime } from "./create-agent-runtime.ts";
import { createCodexRuntime } from "./create-codex-runtime.ts";
import { HOOK_SCRIPT_PATH } from "./hooks.ts";

const roots: string[] = [];
function createRoot() {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/agent-runtime-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fakeEnv(root: string) {
  return {
    PATH: process.env.PATH,
    HOME: root,
    PLANNER_HOME: root,
    PLANNER_CLAUDE_BIN: resolve("test/fake-cli/claude"),
    PLANNER_CODEX_BIN: resolve("test/fake-cli/codex"),
  };
}

function readSession(options: { root: string; id: string }) {
  return JSON.parse(
    readFileSync(
      join(options.root, ".planner", "sessions", `${options.id}.json`),
      "utf8",
    ),
  );
}

for (const cli of ["claude", "codex"] as const) {
  it(`${cli} runs a turn, then resumes the same session`, async () => {
    const root = createRoot();
    const runtime = createAgentRuntime({ env: fakeEnv(root) });
    const turn = {
      project: root,
      session: { role: "designer" as const, cli },
      model: "fake-model",
      systemPrompt: "role",
      prompt: "[fake:echo] hello",
    };
    const first = await runtime.runTurn(turn);
    expect(first).toMatchObject({
      isError: false,
      finalText: "Fake agent reply",
    });
    const saved = readSession({ root, id: "designer-1" });
    expect(saved.status).toBe("idle");
    const second = await runtime.runTurn(turn);
    expect(second.sessionId).toBe(saved.sessionId);
    expect(
      readFileSync(
        join(root, ".planner", "logs", "designer-1-2.jsonl"),
        "utf8",
      ),
    ).toContain('"resume":true');
  });

  it(`${cli} retries once in a new session when the resumed one is gone`, async () => {
    const root = createRoot();
    const runtime = createAgentRuntime({ env: fakeEnv(root) });
    const turn = {
      project: root,
      session: { role: "designer" as const, cli },
      model: "fake-model",
      systemPrompt: "role",
      prompt: "[fake:missing-session]",
      newSessionPrompt: "[fake:missing-session] with the recent history",
    };
    const first = await runtime.runTurn(turn);
    const second = await runtime.runTurn(turn);
    expect(second).toMatchObject({
      isError: false,
      finalText: "Fresh session started",
    });
    expect(second.sessionId).not.toBe(first.sessionId);
    const spawns = readFileSync(
      join(root, ".planner", "logs", "designer-1-2.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter((line) => line.includes('"kind":"spawn"'))
      .map((line) => JSON.parse(line));
    expect(
      spawns.map((spawn) => ({ prompt: spawn.prompt, resume: spawn.resume })),
    ).toStrictEqual([
      { prompt: "[fake:missing-session]", resume: true },
      {
        prompt: "[fake:missing-session] with the recent history",
        resume: false,
      },
    ]);
  });

  it(`${cli} kills the whole process group when a stopped turn ignores SIGTERM`, async () => {
    const root = createRoot();
    const runtime =
      cli === "claude"
        ? new ClaudeRuntime({ killGraceMs: 30 })
        : createCodexRuntime({ killGraceMs: 30 });
    const controller = new AbortController();
    let pid = 0;
    const result = await runtime.run({
      cli,
      sessionId: crypto.randomUUID(),
      resume: false,
      cwd: root,
      model: "fake",
      prompt: "[fake:stubborn-sleep]",
      appendSystemPrompt: "role",
      transcriptPath: join(root, "turn.jsonl"),
      env: fakeEnv(root),
      signal: controller.signal,
      onSpawn(value) {
        pid = value;
        setTimeout(() => controller.abort(), 300);
      },
    });
    expect(result).toMatchObject({
      interrupted: true,
      stopReason: "interrupted",
    });
    expect(() => process.kill(-pid, 0)).toThrow();
  });
}

async function runHook(options: {
  root: string;
  tool: string;
  input: { [key: string]: unknown };
  env?: { [key: string]: string };
}) {
  return exec({
    command: process.execPath,
    args: [HOOK_SCRIPT_PATH],
    input: JSON.stringify({
      tool_name: options.tool,
      tool_input: options.input,
      cwd: options.root,
    }),
    env: {
      PATH: process.env.PATH,
      PLANNER_PROJECT: options.root,
      ...options.env,
    },
  });
}

it("lets a read-only turn use only its allowed tools", async () => {
  const root = createRoot();
  const env = {
    PLANNER_READ_ONLY: "1",
    PLANNER_TOOL_ALLOWLIST: JSON.stringify(["mcp__planner__scene_get"]),
  };
  expect(
    (await runHook({ root, tool: "mcp__planner__scene_get", input: {}, env }))
      .code,
  ).toBe(0);
  for (const tool of ["Bash", "Read", "Write", "mcp__planner__scene_apply"])
    expect((await runHook({ root, tool, input: {}, env })).code).toBe(2);
});

it("blocks writes to project state and outside the write root", async () => {
  const root = createRoot();
  for (const file of [
    "project.json",
    ".planner/chat.json",
    "x/../project.json",
  ])
    expect(
      (await runHook({ root, tool: "Write", input: { file_path: file } })).code,
    ).toBe(2);
  expect(
    (await runHook({ root, tool: "Write", input: { file_path: "notes.md" } }))
      .code,
  ).toBe(0);
  const env = { PLANNER_WRITE_ROOT: join(root, "jobs", "job-1") };
  expect(
    (
      await runHook({
        root,
        tool: "Write",
        input: { file_path: "jobs/job-1/script.py" },
        env,
      })
    ).code,
  ).toBe(0);
  expect(
    (
      await runHook({
        root,
        tool: "Write",
        input: { file_path: "other.py" },
        env,
      })
    ).code,
  ).toBe(2);
});
