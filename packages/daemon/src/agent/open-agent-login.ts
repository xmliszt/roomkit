import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "../util/exec.ts";
import { resolveExecutable } from "../util/resolve-executable.ts";

function quoteShellArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function openAgentLogin(options: {
  cli: "claude" | "codex";
  env: NodeJS.ProcessEnv;
}) {
  if (process.platform !== "darwin")
    throw new Error("Open a terminal on the Mac running Roomkit to sign in.");

  const isClaude = options.cli === "claude";
  const executable = resolveExecutable({
    command:
      (isClaude
        ? options.env.PLANNER_CLAUDE_BIN
        : options.env.PLANNER_CODEX_BIN) ?? options.cli,
    env: options.env,
  });
  try {
    if (!executable.startsWith("/")) throw new Error();
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error("Install the agent before signing in.");
  }

  const folder = await mkdtemp(join(tmpdir(), "roomkit-login-"));
  const file = join(folder, "Sign in to Roomkit.command");
  const authVariable = isClaude ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const authFolder = resolve(
    options.env[authVariable] ||
      join(options.env.HOME ?? homedir(), isClaude ? ".claude" : ".codex"),
  );
  try {
    await writeFile(
      file,
      [
        "#!/bin/sh",
        'rm -f -- "$0"',
        `rmdir -- "\${0%/*}"`,
        `export ${authVariable}=${quoteShellArgument(authFolder)}`,
        `exec ${quoteShellArgument(executable)} ${isClaude ? "auth login" : "login"}`,
        "",
      ].join("\n"),
      { mode: 0o700, flag: "wx" },
    );
    const result = await exec({
      command: "/usr/bin/open",
      args: ["-a", "Terminal", file],
      timeoutMs: 10000,
    });
    if (result.code !== 0 || result.timedOut)
      throw new Error(
        "Could not open Terminal. Run the sign-in command on this Mac.",
      );
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
