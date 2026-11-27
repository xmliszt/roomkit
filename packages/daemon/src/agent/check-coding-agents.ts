import type { CodingAgentStatus } from "@planner/shared/src/agents/coding-agent-status-schema.ts";
import { exec } from "../util/exec.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";
import { scrubbedEnv } from "../util/scrubbed-env.ts";
import {
  type FetchJson,
  readCodingAgentUsage,
} from "./read-coding-agent-usage.ts";

type CheckCodingAgentsOptions = {
  runCommand?: typeof exec;
  readUsage?: typeof readCodingAgentUsage;
  fetchJson?: FetchJson;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cli?: "claude" | "codex" | undefined;
};

function readClaudeAuth(stdout: string) {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value !== "object" || value === null)
      return { isAuthenticated: false, plan: undefined };
    return {
      isAuthenticated: "loggedIn" in value && value.loggedIn === true,
      plan:
        "subscriptionType" in value &&
        typeof value.subscriptionType === "string"
          ? value.subscriptionType
          : undefined,
    };
  } catch {
    return { isAuthenticated: false, plan: undefined };
  }
}

export async function checkCodingAgents(
  options: CheckCodingAgentsOptions = {},
) {
  const runCommand = options.runCommand ?? exec;
  const readUsage = options.readUsage ?? readCodingAgentUsage;
  const env = options.env ?? process.env;
  const kinds: CodingAgentStatus["cli"][] = ["claude", "codex"];
  return Promise.all(
    kinds
      .filter((kind) => !options.cli || kind === options.cli)
      .map(async (kind): Promise<CodingAgentStatus> => {
        const command = resolveExecutable({
          env,
          command:
            env[
              kind === "claude" ? "PLANNER_CLAUDE_BIN" : "PLANNER_CODEX_BIN"
            ] ?? kind,
        });
        const checkedAt = new Date().toISOString();
        const base = { cli: kind, path: command, checkedAt };
        const name = kind === "codex" ? "Codex" : "Claude Code";
        try {
          const version = await runCommand({
            command,
            args: ["--version"],
            timeoutMs: 5000,
            env: scrubbedEnv({ env }),
          });
          if (version.timedOut)
            return {
              ...base,
              status: "error",
              message: `${name} --version timed out. Try checking again.`,
            };
          if (version.code !== 0)
            return {
              ...base,
              status: version.code === 127 ? "not-installed" : "error",
              message:
                version.code === 127
                  ? `${name} is not installed on this Mac.`
                  : "The coding agent did not respond. Check its installation, then try again.",
            };
          const versionText = version.stdout.trim().split("\n").at(0);
          if (kind === "codex") {
            const help = await runCommand({
              command,
              args: ["exec", "--help"],
              timeoutMs: 5000,
              env: scrubbedEnv({ env }),
            });
            if (help.timedOut)
              return {
                ...base,
                ...(versionText ? { version: versionText } : {}),
                status: "error",
                message: "codex exec --help timed out. Try checking again.",
              };
            if (
              help.code !== 0 ||
              !help.stdout.includes("--ignore-user-config") ||
              !help.stdout.includes("--dangerously-bypass-hook-trust")
            ) {
              return {
                ...base,
                ...(versionText ? { version: versionText } : {}),
                status: "error",
                message:
                  "Update Codex CLI to a version with isolated configuration and hook support, then check again.",
              };
            }
          }
          const auth = await runCommand({
            command,
            args:
              kind === "codex"
                ? ["login", "status"]
                : ["auth", "status", "--json"],
            timeoutMs: 5000,
            env: scrubbedEnv({ env }),
          });
          const claudeAuth =
            kind === "claude" ? readClaudeAuth(auth.stdout) : undefined;
          const isAuthenticated =
            auth.code === 0 &&
            (kind === "codex"
              ? /^Logged in using \S/im.test(`${auth.stdout}\n${auth.stderr}`)
              : claudeAuth?.isAuthenticated === true);
          const status = auth.timedOut
            ? "error"
            : isAuthenticated
              ? "ready"
              : "sign-in";
          return {
            ...base,
            ...(versionText ? { version: versionText } : {}),
            status,
            message: auth.timedOut
              ? "Sign-in check timed out. Try checking again."
              : isAuthenticated
                ? "Installed and signed in. Ready for tasks."
                : "Installed. Sign in on this Mac, then check again.",
            ...(status === "ready"
              ? {
                  usage: await readUsage({
                    kind,
                    runCommand,
                    env,
                    ...(claudeAuth?.plan ? { plan: claudeAuth.plan } : {}),
                    ...(options.fetchJson
                      ? { fetchJson: options.fetchJson }
                      : {}),
                    ...(options.platform ? { platform: options.platform } : {}),
                  }),
                }
              : {}),
          };
        } catch {
          return {
            ...base,
            status: "error",
            message: "Coding agent check failed.",
          };
        }
      }),
  );
}
