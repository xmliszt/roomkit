import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { exec } from "../util/exec.ts";
import { checkCodingAgents } from "./check-coding-agents.ts";
import { createCodingAgentChecker } from "./create-coding-agent-checker.ts";

function createCommandRecorder() {
  const calls: Parameters<typeof exec>[0][] = [];
  async function runCommand(input: Parameters<typeof exec>[0]) {
    calls.push(input);
    return {
      code: 0,
      stdout: input.args.includes("--version")
        ? "fake 0.0.1\n"
        : input.args.includes("--help")
          ? "--ignore-user-config --dangerously-bypass-hook-trust"
          : input.args.includes("auth")
            ? '{"loggedIn":true}'
            : "Logged in using ChatGPT",
      stderr: "",
      timedOut: false,
    };
  }
  return { calls, runCommand };
}

async function readUsage() {
  return { windows: [], fetchedAt: new Date(0).toISOString() };
}

describe("coding agent checks", () => {
  it("resolves binary overrides and scrubs the command environment", async () => {
    const recorder = createCommandRecorder();
    const result = await checkCodingAgents({
      env: {
        PATH: "/fake/bin",
        PLANNER_CLAUDE_BIN: "/override/claude",
        PLANNER_CODEX_BIN: "/override/codex",
        PLANNER_PORT: "4800",
        EXAMPLE_TOKEN: "obviously-fake-token",
      },
      runCommand: recorder.runCommand,
      readUsage,
    });
    expect(result.map((entry) => [entry.path, entry.status])).toEqual([
      ["/override/claude", "ready"],
      ["/override/codex", "ready"],
    ]);
    expect(
      recorder.calls.every(
        (entry) =>
          entry.env?.PATH === "/fake/bin" &&
          entry.env.PLANNER_PORT === undefined &&
          entry.env.EXAMPLE_TOKEN === undefined,
      ),
    ).toBe(true);
    expect(recorder.calls.map((entry) => entry.args)).toContainEqual([
      "exec",
      "--help",
    ]);
  });

  it.each(["--ignore-user-config", "--dangerously-bypass-hook-trust"])(
    "rejects Codex help missing %s before checking sign-in or usage",
    async (missingFlag) => {
      const recorder = createCommandRecorder();
      const usageKinds: string[] = [];
      const result = await checkCodingAgents({
        env: {},
        async readUsage(input) {
          usageKinds.push(input.kind);
          return readUsage();
        },
        async runCommand(input) {
          const response = await recorder.runCommand(input);
          return input.args.includes("--help")
            ? { ...response, stdout: response.stdout.replace(missingFlag, "") }
            : response;
        },
      });
      expect(result.find((entry) => entry.cli === "codex")).toMatchObject({
        status: "error",
        message:
          "Update Codex CLI to a version with isolated configuration and hook support, then check again.",
      });
      expect(recorder.calls.map((entry) => entry.args)).not.toContainEqual([
        "login",
        "status",
      ]);
      expect(usageKinds).toEqual(["claude"]);
    },
  );

  it("uses PATH defaults and reports missing installations", async () => {
    const commands: string[] = [];
    const result = await checkCodingAgents({
      env: {},
      async runCommand(input) {
        commands.push(input.command);
        return { code: 127, stdout: "", stderr: "not found", timedOut: false };
      },
    });
    expect(commands).toEqual(["claude", "codex"]);
    expect(result.map((entry) => entry.status)).toEqual([
      "not-installed",
      "not-installed",
    ]);
  });

  it("does not accept successful-looking auth output after a failed command", async () => {
    const recorder = createCommandRecorder();
    const result = await checkCodingAgents({
      env: {},
      readUsage,
      async runCommand(input) {
        const response = await recorder.runCommand(input);
        return input.args.includes("status")
          ? { ...response, code: 1 }
          : response;
      },
    });
    expect(result.map((entry) => entry.status)).toEqual(["sign-in", "sign-in"]);
  });

  it("caches status and usage for 30 seconds with explicit refresh", async () => {
    let nowMs = 0;
    const recorder = createCommandRecorder();
    const checker = createCodingAgentChecker({
      env: {},
      runCommand: recorder.runCommand,
      readUsage,
      now: () => nowMs,
    });
    const first = checker.check();
    expect(checker.check()).toBe(first);
    await first;
    expect(recorder.calls).toHaveLength(5);
    nowMs = 29_999;
    expect(checker.check()).toBe(first);
    nowMs = 30_000;
    await checker.check();
    expect(recorder.calls).toHaveLength(10);
    await checker.check({ force: true });
    expect(recorder.calls).toHaveLength(15);
  });
});

it("reports actual missing CLI executables as not installed", async () => {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/agent-check-"));
  try {
    const result = await checkCodingAgents({
      env: {
        HOME: root,
        PLANNER_HOME: root,
        PLANNER_PROJECTS_ROOT: root,
        PLANNER_CLAUDE_BIN: join(root, "missing-claude"),
        PLANNER_CODEX_BIN: join(root, "missing-codex"),
      },
    });
    expect(result.map((entry) => entry.status)).toEqual([
      "not-installed",
      "not-installed",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { output: "Not logged in", status: "sign-in" },
  { output: "Logged in using ChatGPT", status: "ready" },
  { output: "Logged in using API key - fake-key", status: "ready" },
  { output: "Logged in using an API key - fake-key", status: "ready" },
])("classifies Codex login status: $output", async ({ output, status }) => {
  const recorder = createCommandRecorder();
  const result = await checkCodingAgents({
    env: {},
    readUsage,
    async runCommand(input) {
      const response = await recorder.runCommand(input);
      return input.args.includes("login")
        ? { ...response, stdout: output }
        : response;
    },
  });
  expect(result.find((entry) => entry.cli === "codex")?.status).toBe(status);
});

it("reports a timed-out --version as an error, not as missing", async () => {
  const [status] = await checkCodingAgents({
    cli: "claude",
    env: { PATH: "/fake/bin" },
    async runCommand() {
      return { code: 127, stdout: "", stderr: "", timedOut: true };
    },
    readUsage,
  });
  expect(status).toMatchObject({ status: "error" });
  expect(status?.message).toContain("timed out");
});

it("passes the plan from claude auth status to the usage reader", async () => {
  const plans: (string | undefined)[] = [];
  await checkCodingAgents({
    cli: "claude",
    env: { PATH: "/fake/bin" },
    async runCommand(input) {
      return {
        code: 0,
        stdout: input.args.includes("auth")
          ? '{"loggedIn":true,"subscriptionType":"team"}'
          : "fake 0.0.1\n",
        stderr: "",
        timedOut: false,
      };
    },
    async readUsage(input) {
      plans.push(input.plan);
      return { windows: [], fetchedAt: new Date(0).toISOString() };
    },
  });
  expect(plans).toStrictEqual(["team"]);
});

it("reports a timed-out codex exec --help as a timeout, not as an old CLI", async () => {
  const [status] = await checkCodingAgents({
    cli: "codex",
    env: { PATH: "/fake/bin" },
    async runCommand(input) {
      return input.args.includes("--help")
        ? { code: 127, stdout: "", stderr: "", timedOut: true }
        : { code: 0, stdout: "codex 0.165\n", stderr: "", timedOut: false };
    },
    readUsage,
  });
  expect(status?.message).toContain("timed out");
});
